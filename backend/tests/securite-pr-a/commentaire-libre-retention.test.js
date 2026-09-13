// ═══════════════════════════════════════════════════════════════════════════
// REVUE DE SÉCURITÉ PR A — C-05 : le commentaire libre des questionnaires FSE+
// est en CLAIR en base, servi au MANAGER, et SURVIT à l'anonymisation.
//
// La PR ajoute un item `commentaire` (texte libre, 2 000 caractères) aux DEUX
// questionnaires (utils/fse-schema.js l.74 et l.129). Ce texte atterrit dans
// `insertion_diagnostics.fse_entree` et `insertion_fse_sorties.fse_sortie`,
// deux JSONB que `services/anonymization.js` CONSERVE délibérément au titre de
// la piste d'audit FSE+ (≥ 5 ans). Or :
//   - un texte libre d'accompagnement porte par nature de la santé (art. 9) ou
//     du contexte judiciaire (art. 10) sans qu'aucune colonne ne l'annonce —
//     c'est le raisonnement qui a fait chiffrer les notes de suivi en 2.47.0 ;
//   - il n'entre dans AUCUN des 29 colonnes de l'export : il n'est donc pas la
//     pièce d'audit que la conservation prétend protéger ;
//   - l'entrée art. 30 du registre affirme « AUCUNE donnée de santé ni
//     judiciaire » pour ce traitement.
// Tests de REPRODUCTION (verts tant que le défaut est là) + une garde statique.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { FSE_ENTREE_ITEMS, FSE_SORTIE_ITEMS, valider, MAX_TEXTE } = require('../../src/utils/fse-schema');

const src = (p) => fs.readFileSync(path.join(__dirname, '../../src', p), 'utf8');

describe('C-05 — commentaire libre des questionnaires FSE+', () => {
  test('les deux questionnaires acceptent 2 000 caractères de texte libre', () => {
    expect(FSE_ENTREE_ITEMS.find((i) => i.cle === 'commentaire')).toBeDefined();
    expect(FSE_SORTIE_ITEMS.find((i) => i.cle === 'commentaire')).toBeDefined();
    expect(MAX_TEXTE).toBe(2000);

    const recit = 'Hospitalisation en psychiatrie en mars ; sursis probatoire jusqu’en 2027.';
    const v = valider({ commentaire: recit }, FSE_ENTREE_ITEMS);
    expect(v.ok).toBe(true);
    // Il ressort TEL QUEL : ni tronqué, ni chiffré, ni marqué sensible.
    expect(v.valeurs.commentaire).toBe(recit);
  });

  test('DÉFAUT — il n’est PAS chiffré : aucune clé FSE+ dans SENSITIVE_DIAG_FIELDS', () => {
    const { SENSITIVE_DIAG_FIELDS } = require('../../src/utils/field-crypto');
    expect(SENSITIVE_DIAG_FIELDS).not.toContain('fse_entree');
    expect(SENSITIVE_DIAG_FIELDS.some((f) => String(f).includes('fse'))).toBe(false);
  });

  test('DÉFAUT — l’anonymisation ne touche jamais `insertion_fse_sorties` ni `fse_entree`', () => {
    const anon = src('services/anonymization.js');
    // Aucune instruction (DELETE / UPDATE / deleteBy) sur la table des sorties :
    expect(/deleteBy\(\s*client,\s*'insertion_fse_sorties'/.test(anon)).toBe(false);
    expect(/DELETE FROM insertion_fse_sorties/.test(anon)).toBe(false);
    // `fse_entree` n'est cité que dans un commentaire de conservation :
    const lignesActives = anon
      .split('\n')
      .filter((l) => l.includes('fse_entree') || l.includes('fse_sortie'))
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    expect(lignesActives).toHaveLength(0);
  });

  test('DÉFAUT — le commentaire ne figure dans AUCUNE des 29 colonnes de l’export', () => {
    const { COLONNES } = require('../../src/routes/exports-fse');
    expect(COLONNES).toHaveLength(29);
    expect(COLONNES.join('|').toLowerCase()).not.toContain('commentaire');
    // Donc sa conservation ne sert PAS la piste d'audit qui la justifie.
  });

  test('le registre art. 30 du traitement FSE+ promet « AUCUNE donnée de santé ni judiciaire »', () => {
    const mig = src('scripts/migrations/insertion-fse.js');
    expect(mig).toContain('AUCUNE donnée de santé ni judiciaire');
    // …et ne mentionne nulle part le commentaire libre dans les catégories.
    const bloc = mig.slice(mig.indexOf('categories_donnees'), mig.indexOf('WHERE NOT EXISTS'));
    expect(bloc.toLowerCase()).not.toContain('commentaire libre');
  });
});

describe('C-06 — le CHECK `situation_6mois` n’est pas élargi sur une base déjà migrée', () => {
  test('DÉFAUT — « injoignable » n’existe que dans le CREATE TABLE, sans DO-scan de reconstruction', () => {
    const mig = src('scripts/migrations/insertion-fse.js');
    const occurrences = (mig.match(/injoignable/g) || []).length;
    // Une seule occurrence = l'inline du CREATE TABLE IF NOT EXISTS. Une base
    // où la migration a déjà tourné (commit cb31d89) garde l'ancien CHECK et
    // refusera la valeur en 23514 — alors que les alertes, elles, ont bien
    // leur DO-scan d'élargissement juste en dessous.
    expect(occurrences).toBe(1);
    expect(/ALTER TABLE insertion_fse_sorties[\s\S]{0,200}injoignable/.test(mig)).toBe(false);
    // Contre-exemple : le CHECK des alertes, lui, EST reconstruit.
    expect(/DROP CONSTRAINT[\s\S]{0,400}insertion_interview_alerts_alert_type_check/.test(mig)).toBe(true);
  });

  test('mais le code applicatif, lui, propose déjà « injoignable »', () => {
    const { SITUATIONS_6MOIS } = require('../../src/utils/fse-schema');
    expect(SITUATIONS_6MOIS).toContain('injoignable');
  });
});
