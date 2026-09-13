// ═══════════════════════════════════════════════════════════════════════════
// REVUE DE SÉCURITÉ PR A — M-03 et M-05.
//
// M-03 : le commentaire libre des questionnaires FSE+ (2 000 caractères,
// ajoutés aux DEUX questionnaires par cette PR) atterrit dans deux JSONB que
// l'anonymisation CONSERVE délibérément au titre de la piste d'audit (≥ 5 ans).
// Or un texte libre d'accompagnement porte par nature de la santé (art. 9) ou
// du contexte judiciaire (art. 10) sans qu'aucune colonne ne l'annonce — c'est
// le raisonnement qui a fait chiffrer les notes de suivi en 2.47.0 — et il
// n'entre dans AUCUNE des 29 colonnes de l'export : il n'est donc pas la pièce
// d'audit que sa conservation prétendait protéger.
//
// M-05 : « injoignable » n'avait été ajouté qu'au CREATE TABLE. Sur une base
// déjà migrée, l'ancien CHECK survivait et le relevé à six mois échouait en 500.
//
// TESTS RETOURNÉS le 13/09 : ils prouvaient l'ABSENCE de purge et l'ABSENCE de
// DO-scan (« vert = défaut présent ») ; ils prouvent désormais leur présence, et
// surtout ce qui NE doit PAS avoir été fait — les réponses typées restent, le
// registre art. 30 dit la vérité.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { FSE_ENTREE_ITEMS, FSE_SORTIE_ITEMS, valider, MAX_TEXTE } = require('../../src/utils/fse-schema');

const src = (p) => fs.readFileSync(path.join(__dirname, '../../src', p), 'utf8');

describe('M-03 — commentaire libre des questionnaires FSE+', () => {
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

  test('il n’est PAS chiffré — choix ASSUMÉ, puisqu’il est désormais purgé', () => {
    // Des trois remèdes proposés par la revue (purger, chiffrer, retirer
    // l'item), c'est la PURGE à l'anonymisation qui a été retenue : la moins
    // coûteuse, et suffisante — la CIP garde son journal de suivi chiffré
    // (2.47.0) pour ce qu'elle veut écrire librement. Le chiffrement aurait
    // ajouté une clé de plus dans un JSONB destiné à être relu par un
    // contrôleur cinq ans plus tard.
    const { SENSITIVE_DIAG_FIELDS } = require('../../src/utils/field-crypto');
    expect(SENSITIVE_DIAG_FIELDS).not.toContain('fse_entree');
  });

  test('CORRIGÉ — l’anonymisation RETIRE le commentaire des deux questionnaires', () => {
    const anon = src('services/anonymization.js');
    // Le retrait porte sur la seule clé `commentaire` (opérateur JSONB `-`)…
    expect(anon).toContain("${colonne} = ${colonne} - 'commentaire'");
    expect(anon).toContain("['insertion_fse_sorties', 'fse_sortie']");
    expect(anon).toContain("['insertion_diagnostics', 'fse_entree']");
    expect(anon).toContain("['insertion_milestones', 'fse_sortie']");
    // …et JAMAIS sur les LIGNES : la piste d'audit FSE+ survit, c'est la raison
    // d'être de sa conservation. Le correctif ne doit pas la détruire.
    expect(/DELETE FROM insertion_fse_sorties/.test(anon)).toBe(false);
    expect(/deleteBy\(\s*client,\s*'insertion_fse_sorties'/.test(anon)).toBe(false);
  });

  test('le commentaire ne figure dans aucune des 29 colonnes — la purge est donc sans perte', () => {
    const { COLONNES } = require('../../src/routes/exports-fse');
    expect(COLONNES).toHaveLength(29);
    expect(COLONNES.join('|').toLowerCase()).not.toContain('commentaire');
    // C'est l'argument du correctif : ce texte ne sert AUCUN export ni bilan,
    // le retirer n'ôte rien à la pièce d'audit.
  });

  test('CORRIGÉ — le registre art. 30 dit désormais la vérité sur ce commentaire', () => {
    const mig = src('scripts/migrations/insertion-fse.js');
    // La promesse est maintenue pour le judiciaire, et NUANCÉE pour l'art. 9 :
    // la colonne 10 porte des critères d'éligibilité qui peuvent en relever.
    expect(mig).toContain('AUCUNE donnée judiciaire');
    expect(mig).toContain('sensible art. 10');
    // Le commentaire libre est NOMMÉ dans les catégories de données, avec son
    // sort : jamais exporté, retiré à l'anonymisation.
    expect(mig).toContain('COMMENTAIRE LIBRE');
    expect(mig).toContain("RETIRÉ à l'anonymisation");
    // Et l'entrée déjà écrite en base est reprise, sous double garde.
    expect(mig).toContain("categories_donnees NOT LIKE '%sensible art. 10%'");
  });
});

describe('M-05 — le CHECK `situation_6mois` est élargi sur une base déjà migrée', () => {
  test('CORRIGÉ — « injoignable » est posé par un DO-scan de reconstruction', () => {
    const mig = src('scripts/migrations/insertion-fse.js');
    // Le DO-scan ne DROP que les contraintes qui portent sur cette colonne ET
    // qui ignorent encore la valeur : rejouable sans effet.
    expect(/DROP CONSTRAINT[\s\S]{0,600}insertion_fse_sorties_situation_6mois_check/.test(mig)).toBe(true);
    expect(mig).toContain("pg_get_constraintdef(oid) ILIKE '%situation_6mois%'");
    expect(mig).toContain("pg_get_constraintdef(oid) NOT ILIKE '%injoignable%'");
    // La nouvelle liste contient TOUTE l'ancienne : aucune ligne existante ne
    // peut être refusée par la contrainte reconstruite.
    const bloc = mig.slice(mig.indexOf('ADD CONSTRAINT insertion_fse_sorties_situation_6mois_check'));
    for (const v of ['emploi_durable', 'emploi_transition', 'formation',
      'autre_sortie_positive', 'inactivite', 'chomage', 'inconnue', 'injoignable']) {
      expect(bloc).toContain(`'${v}'`);
    }
    // Contre-exemple conservé : le CHECK des alertes est reconstruit de même.
    expect(/DROP CONSTRAINT[\s\S]{0,400}insertion_interview_alerts_alert_type_check/.test(mig)).toBe(true);
  });

  test('mais le code applicatif, lui, propose déjà « injoignable »', () => {
    const { SITUATIONS_6MOIS } = require('../../src/utils/fse-schema');
    expect(SITUATIONS_6MOIS).toContain('injoignable');
  });
});
