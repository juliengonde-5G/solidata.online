/**
 * Tests du backfill des poids VAK (backfill-vak-poids.js) — extension
 * « chaussures au poids » (données réelles FRIP & CO, transaction TAAA4NKXTDV :
 * « 1.595 x Chaussures » = 1,595 kg × 3,00 €/kg — la quantité SumUp EST le
 * poids en kg pour les segments KG_SEGMENTS = textile_vrac + chaussures).
 *
 * On teste la fonction PURE exportée classifierRequalification (aucune DB) :
 *  - 'kg'        → ligne requalifiée unite = 'kg' (poids recalculé ensuite) ;
 *  - 'ambigue'   → libellé au poids MAIS |quantité| = 1 EXACTEMENT sur source
 *                  API/webhook : jamais requalifiée (doctrine PR#90 « jamais
 *                  de valeur inventée » — indistinguable de la ligne globale
 *                  synthétique du fallback d'ingestion, d'une vente à la pièce
 *                  historique ou d'une vraie vente de 1,000 kg pile) ;
 *  - 'inchangee' → rien à faire.
 */

const { classifierRequalification } = require('../../../src/scripts/backfill-vak-poids');

describe('backfill-vak-poids — classifierRequalification (extension chaussures)', () => {
  test('ligne stockée « Chaussures » qté 1.595 unite pce, source api_sumup → requalifiée kg', () => {
    // Historique d'avant l'extension : les chaussures étaient traitées à la
    // pièce → leur poids était PERDU. La quantité DÉCIMALE prouve un poids pesé.
    expect(classifierRequalification({
      description: 'Chaussures', unite: 'pce', source: 'api_sumup', quantite: 1.595,
    })).toBe('kg');
  });

  test('ligne « Chaussures » qté 1 EXACTEMENT, source api/webhook → NON requalifiée (ambiguë)', () => {
    // |qté| = 1 pile : ligne synthétique du fallback, vraie vente d'1 paire à
    // la pièce, ou vraie vente de 1,000 kg — indistinguables a posteriori.
    // On n'invente jamais un poids ; resync-vak-details.js relit SumUp.
    expect(classifierRequalification({
      description: 'Chaussures', unite: 'pce', source: 'api_sumup', quantite: 1,
    })).toBe('ambigue');
    expect(classifierRequalification({
      description: 'Chaussures', unite: 'pce', source: 'webhook_sumup', quantite: -1,
    })).toBe('ambigue'); // remboursement synthétique : même garde en signé
  });

  test('la garde |qté| = 1 est STRICTE (=== 1, pas ≤ 1) : 0.92 kg réel requalifié', () => {
    // Ligne réelle observée « 0.92 x Vente Moins de 5 Kg » : une quantité
    // décimale < 1 est un poids pesé RÉEL, elle doit être requalifiée.
    expect(classifierRequalification({
      description: 'Vente Moins de 5 Kg', unite: 'pce', source: 'api_sumup', quantite: 0.92,
    })).toBe('kg');
    expect(classifierRequalification({
      description: 'Chaussures', unite: '', source: 'api_sumup', quantite: 0.35,
    })).toBe('kg');
  });

  test('textile vrac décimal api/webhook → requalifié (comportement historique conservé)', () => {
    expect(classifierRequalification({
      description: 'Vente plus de 5 kilos', unite: 'pce', source: 'api_sumup', quantite: 10.575,
    })).toBe('kg');
    expect(classifierRequalification({
      description: 'Vente moins de 5 kg', unite: '', source: 'webhook_sumup', quantite: -3.2,
    })).toBe('kg'); // remboursement : quantité signée, requalification identique
  });

  test('ticket MULTI-lignes : une ligne au poids qté 1 exactement est un VRAI 1,000 kg → requalifiée (revue Codex PR#91)', () => {
    // La ligne globale synthétique n'a jamais produit de ticket multi-lignes :
    // dans un ticket multi-lignes, le détail vient de vrais produits SumUp —
    // sans cette règle, la ligne tombait entre les deux filets (le resync ne
    // sélectionne que les tickets à 0/1 ligne).
    expect(classifierRequalification({
      description: 'Chaussures', unite: 'pce', source: 'api_sumup', quantite: 1,
      nb_lignes_ticket: 2,
    })).toBe('kg');
    expect(classifierRequalification({
      description: 'Vente plus de 5 kilos', unite: 'pce', source: 'webhook_sumup', quantite: -1,
      nb_lignes_ticket: 3,
    })).toBe('kg'); // remboursement multi-lignes : signé, requalifié aussi
    // Mono-ligne explicite : la garde d'ambiguïté reste entière.
    expect(classifierRequalification({
      description: 'Chaussures', unite: 'pce', source: 'api_sumup', quantite: 1,
      nb_lignes_ticket: 1,
    })).toBe('ambigue');
  });

  test('forme SYNTHÉTIQUE (ligne globale qté 1 du fallback) → couverte par la garde ambiguë', () => {
    // Ancienne garde PR#90 (1 ligne, |qté| = 1) : englobée par la garde |qté|=1.
    expect(classifierRequalification({
      description: 'Vente plus de 5 kilos', unite: 'pce', source: 'api_sumup', quantite: 1,
    })).toBe('ambigue');
  });

  test('consommables (sacs) et libellés inconnus → jamais requalifiés', () => {
    expect(classifierRequalification({
      description: 'Sacs', unite: 'pce', source: 'api_sumup', quantite: 2,
    })).toBe('inchangee');
    expect(classifierRequalification({
      description: 'Article divers', unite: 'pce', source: 'api_sumup', quantite: 3.2,
    })).toBe('inchangee');
  });

  test('source CSV : la colonne « Unité » stockée FAIT FOI', () => {
    // Unité explicite pce → respectée, même sur un libellé au poids.
    expect(classifierRequalification({
      description: 'Chaussures', unite: 'pce', source: 'csv_manuel', quantite: 1.595,
    })).toBe('inchangee');
    // Unité vide + libellé au poids → requalifiée (inférence, comme l'ingestion).
    expect(classifierRequalification({
      description: 'Chaussures', unite: '', source: 'csv_manuel', quantite: 1.595,
    })).toBe('kg');
    expect(classifierRequalification({
      description: 'Vente moins de 5 kg', unite: null, source: 'csv_manuel', quantite: 2.755,
    })).toBe('kg');
  });
});
