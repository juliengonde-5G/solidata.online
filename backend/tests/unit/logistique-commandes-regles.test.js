/**
 * RÈGLES DU SUIVI LOGISTIQUE UNIFIÉ (2.59.0) — frontend/src/utils/logistique-commandes.js
 *
 * Le tableau des commandes réunit les commandes des EXUTOIRES et celles des
 * BOUTIQUES. Ce fichier verrouille ce que fait le glisser-déposer :
 *   - un simple changement de statut appelle la route du bon système ;
 *   - une étape qui demande une saisie (préparation, pesée, expédition d'un
 *     exutoire) ouvre la fiche au lieu d'avancer à l'aveugle ;
 *   - on ne recule pas, on ne saute pas d'étape, une boutique ne passe pas par
 *     « Prête / chargée » ni « Terminée ».
 * Le module (ES, sans import) est évalué tel quel, comme le navigateur le fait.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CHEMIN = path.join(__dirname, '../../../frontend/src/utils/logistique-commandes.js');

function charger() {
  let code = fs.readFileSync(CHEMIN, 'utf8');
  const exportes = [];
  code = code.replace(/export\s+(const|function)\s+([A-Za-z0-9_$]+)/g, (_, kind, nom) => {
    exportes.push(nom);
    return `${kind} ${nom}`;
  });
  code += `\n;__exports__ = { ${exportes.join(', ')} };`;
  const ctx = { __exports__: null, Date, Number, String };
  vm.runInNewContext(code, ctx);
  return ctx.__exports__;
}

const R = charger();
const exu = (statut) => ({ type: 'exutoire', statut, nativeId: 7 });
const btq = (statut) => ({ type: 'boutique', statut, nativeId: 12 });

describe('colonnes', () => {
  test('les deux systèmes tombent dans les mêmes colonnes', () => {
    expect(R.colonneDe(exu('en_attente'))).toBe('a_traiter');
    expect(R.colonneDe(btq('envoyee'))).toBe('a_traiter');
    expect(R.colonneDe(exu('confirmee'))).toBe('validee');
    expect(R.colonneDe(btq('ajustee'))).toBe('validee');
    expect(R.colonneDe(exu('en_preparation'))).toBe('en_preparation');
    expect(R.colonneDe(btq('en_preparation'))).toBe('en_preparation');
    expect(R.colonneDe(exu('chargee'))).toBe('prete');
    expect(R.colonneDe(exu('expediee'))).toBe('expediee');
    expect(R.colonneDe(btq('expediee'))).toBe('expediee');
    expect(R.colonneDe(exu('facturee'))).toBe('terminee');
  });

  test('brouillon et annulée restent hors tableau', () => {
    expect(R.colonneDe(btq('brouillon'))).toBeNull();
    expect(R.colonneDe(btq('annulee'))).toBeNull();
    expect(R.colonneDe(exu('annulee'))).toBeNull();
  });
});

describe('glisser-déposer — commande boutique', () => {
  test('chaque étape appelle la route de la commande boutique', () => {
    expect(R.actionDeplacement(btq('envoyee'), 'validee')).toMatchObject({ kind: 'api', url: '/boutique-commandes/12/ajuster' });
    expect(R.actionDeplacement(btq('ajustee'), 'en_preparation')).toMatchObject({ kind: 'api', url: '/boutique-commandes/12/preparer' });
  });

  test('de la préparation, elle va DIRECTEMENT à « Expédiée » (pas de chargement de remorque)', () => {
    expect(R.actionDeplacement(btq('en_preparation'), 'expediee')).toMatchObject({ kind: 'api', url: '/boutique-commandes/12/expedier' });
    expect(R.actionDeplacement(btq('en_preparation'), 'prete').kind).toBe('refus');
    expect(R.actionDeplacement(btq('expediee'), 'terminee').kind).toBe('refus');
  });
});

describe('glisser-déposer — commande exutoire', () => {
  test('la confirmation est un simple changement de statut', () => {
    expect(R.actionDeplacement(exu('en_attente'), 'validee'))
      .toMatchObject({ kind: 'api', url: '/commandes-exutoires/7/statut', body: { statut: 'confirmee' } });
  });

  test('préparation, fin de chargement et expédition OUVRENT la fiche (saisie nécessaire, sortie de stock)', () => {
    expect(R.actionDeplacement(exu('confirmee'), 'en_preparation')).toMatchObject({ kind: 'fiche', section: 'preparation' });
    expect(R.actionDeplacement(exu('en_preparation'), 'prete')).toMatchObject({ kind: 'fiche', section: 'preparation' });
    expect(R.actionDeplacement(exu('chargee'), 'expediee')).toMatchObject({ kind: 'fiche', section: 'preparation' });
  });

  test('« Terminée » enregistre la pesée client reçue', () => {
    expect(R.actionDeplacement(exu('expediee'), 'terminee')).toMatchObject({ kind: 'api', body: { statut: 'pesee_recue' } });
  });
});

describe('garde-fous communs', () => {
  test('pas de retour en arrière, pas de saut d\'étape', () => {
    expect(R.actionDeplacement(exu('confirmee'), 'a_traiter').kind).toBe('refus');
    expect(R.actionDeplacement(btq('en_preparation'), 'validee').kind).toBe('refus');
    expect(R.actionDeplacement(exu('en_attente'), 'en_preparation').kind).toBe('refus');
    expect(R.actionDeplacement(btq('envoyee'), 'en_preparation').kind).toBe('refus');
  });

  test('déposer dans sa propre colonne ne fait rien', () => {
    expect(R.actionDeplacement(btq('envoyee'), 'a_traiter').kind).toBe('rien');
  });

  test('une commande terminée depuis plus de 30 jours quitte le tableau par défaut', () => {
    const maintenant = new Date('2026-09-25T12:00:00Z').getTime();
    expect(R.estAncienneTerminee({ ...btq('expediee'), updated_at: '2026-08-01T00:00:00Z' }, 30, maintenant)).toBe(true);
    expect(R.estAncienneTerminee({ ...btq('expediee'), updated_at: '2026-09-20T00:00:00Z' }, 30, maintenant)).toBe(false);
    // Une commande encore en cours ne disparaît jamais, quel que soit son âge.
    expect(R.estAncienneTerminee({ ...exu('expediee'), updated_at: '2025-01-01T00:00:00Z' }, 30, maintenant)).toBe(false);
  });
});
