/**
 * Garde du test post-déploiement (`scripts/tests/api-smoke.js`).
 *
 * Ce script n'est pas exécuté par Jest (il frappe un vrai serveur). Mais trois
 * de ses propriétés sont des décisions de SÉCURITÉ, pas des détails
 * d'implémentation, et rien ne les protégerait d'un retour en arrière :
 *   1. il ne se connecte plus avec un compte humain (plus de mot de passe ni de
 *      secret TOTP dans le `.env` du serveur) ;
 *   2. il garde ses deux sondes de sécurité, et les rend EXPLICABLES : les deux
 *      échecs de connexion qu'elles laissent au journal doivent se comprendre
 *      d'eux-mêmes (identifiant réservé) ;
 *   3. l'absence de clé DÉGRADE la couverture, elle ne fait jamais échouer le
 *      déploiement.
 *
 * Le test lit le source, il n'exécute rien.
 */
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..', '..', '..');
const SMOKE = fs.readFileSync(path.join(RACINE, 'scripts', 'tests', 'api-smoke.js'), 'utf8');
const DEPLOY = fs.readFileSync(path.join(RACINE, 'deploy', 'scripts', 'deploy.sh'), 'utf8');

describe('le smoke test ne détient plus de secret de compte humain', () => {
  test('il ne lit ni identifiant, ni mot de passe, ni secret TOTP', () => {
    for (const variable of ['API_USER', 'API_PASSWORD', 'API_TOTP_SECRET']) {
      expect(SMOKE).not.toMatch(new RegExp(`process\\.env\\.${variable}`));
    }
  });

  test('il ne calcule plus de code TOTP', () => {
    expect(SMOKE).not.toMatch(/utils\/totp/);
    expect(SMOKE).not.toMatch(/mfa_challenge_token/);
  });

  test('il n’appelle plus /auth/login pour OBTENIR une session', () => {
    // Les deux seuls appels restants à /auth/login sont les sondes de sécurité,
    // qui doivent être REFUSÉES (401). Aucun n'attend de jeton.
    expect(SMOKE).not.toMatch(/accessToken/);
    expect(SMOKE).not.toMatch(/Authorization: `Bearer/);
  });

  test('il présente une clé d’API de service en en-tête X-API-Key', () => {
    expect(SMOKE).toMatch(/process\.env\.SMOKE_API_KEY/);
    expect(SMOKE).toMatch(/'X-API-Key': SMOKE_API_KEY/);
  });
});

describe('les deux sondes de sécurité sont conservées et explicables', () => {
  test('elles portent un identifiant RÉSERVÉ, jamais un compte réel', () => {
    expect(SMOKE).toMatch(/const IDENTIFIANT_SONDE = 'smoke-test-identifiant-invalide'/);
    // Les deux appels à /auth/login utilisent cet identifiant.
    const appels = [...SMOKE.matchAll(/request\('POST', '\/api\/auth\/login',\s*\n?\s*\{ username: ([^,]+),/g)];
    expect(appels.length).toBe(2);
    for (const a of appels) expect(a[1]).toMatch(/IDENTIFIANT_SONDE/);
  });

  test('la sonde d’injection SQL est toujours là', () => {
    expect(SMOKE).toMatch(/OR '1'='1/);
  });

  test('le script explique au lecteur du journal ce que sont ces échecs', () => {
    expect(SMOKE).toMatch(/autocontrôles du déploiement/i);
  });

  test('la lecture seule de la clé est vérifiée sur le serveur déployé', () => {
    expect(SMOKE).toMatch(/SERVICE_KEY_READ_ONLY/);
  });
});

describe('sans clé, le déploiement continue', () => {
  test('le smoke passe en SKIP (et non en échec) quand la clé est inutilisable', () => {
    // Clé absente, expirée, révoquée, sans scope : ce n'est pas une régression
    // de l'application, c'est un test qu'on ne peut pas exécuter.
    expect(SMOKE).toMatch(/skipMsg\('T-AUTH-03'/);
    // Le seul cas où la perte de couverture fait échouer est le mode STRICT.
    expect(SMOKE).toMatch(/if \(STRICT\) \{\s*\n\s*fail\('T-AUTH-03'/);
  });

  test('… mais un 5xx sur l’identité reste un ÉCHEC (là, le serveur est cassé)', () => {
    expect(SMOKE).toMatch(/status >= 500[\s\S]{0,120}fail\('T-AUTH-03'/);
  });

  test('deploy.sh avertit sans interrompre, et dit comment créer la clé', () => {
    expect(DEPLOY).toMatch(/warn "SMOKE_API_KEY absente du \.env/);
    expect(DEPLOY).toMatch(/creer-cle-api\.js --apply/);
    expect(DEPLOY).not.toMatch(/error "SMOKE_API_KEY/);
  });

  test('deploy.sh ne transporte plus les identifiants du compte de service', () => {
    expect(DEPLOY).not.toMatch(/export API_USER/);
    expect(DEPLOY).not.toMatch(/-e API_USER/);
    expect(DEPLOY).toMatch(/export SMOKE_API_KEY/);
  });
});
