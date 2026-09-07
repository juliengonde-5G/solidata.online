// ═══════════════════════════════════════════════════════════════════════════
// BORDEREAU DÉCHÈTERIE — règles pures (chantier 2.50.0)
// ───────────────────────────────────────────────────────────────────────────
// Trois choses sont verrouillées ici, et chacune coûterait cher autrement :
//
//  1. L'AIGUILLAGE. Un point ordinaire ne doit JAMAIS ouvrir le bordereau (le
//     chauffeur perdrait trois écrans à chaque borne), et un point déchèterie
//     déjà documenté ne doit pas le rouvrir (le serveur créerait un doublon,
//     ou refuserait — dans les deux cas c'est du temps volé sur le quai).
//
//  2. LA VALIDITÉ. Le serveur refuse en 4xx, et un 4xx PURGE la file : un
//     bordereau mal formé parti quand même est un bordereau DÉFINITIVEMENT
//     perdu. On refuse donc AVANT, pendant que l'agent est encore là.
//
//  3. LA FORME DU CORPS JSON (contrat §2.1). C'est le point de contact avec le
//     lot backend, écrit en parallèle : un nom de champ qui dérive et rien ne
//     part.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  MOTIF_AGENT_INDISPONIBLE,
  POIDS_INDICATIF_MAX_KG,
  bordereauRequis,
  poidsIndicatifValide,
  poidsIndicatifNormalise,
  validerBordereau,
  construirePayloadBordereau,
} from '../src/services/decheterie.js';

const PNG = `data:image/png;base64,${'A'.repeat(64)}`;

describe('bordereauRequis — qui déclenche le bordereau', () => {
  it('oui : point déchèterie sans bordereau déposé', () => {
    expect(bordereauRequis({ is_decheterie: true, bordereau_deja_depose: false })).toBe(true);
  });

  it('non : borne de rue ordinaire', () => {
    expect(bordereauRequis({ is_decheterie: false, bordereau_deja_depose: false })).toBe(false);
  });

  it('non : bordereau déjà déposé pour ce passage', () => {
    expect(bordereauRequis({ is_decheterie: true, bordereau_deja_depose: true })).toBe(false);
  });

  it('non : point qui ne porte pas les drapeaux (serveur pas encore à jour)', () => {
    // Dégradation volontaire : le parcours ordinaire continue, personne n'est
    // bloqué par un payload plus ancien que le mobile.
    expect(bordereauRequis({ cav_id: 12, cav_name: 'Rue Machin' })).toBe(false);
  });

  it('non : rien du tout', () => {
    expect(bordereauRequis(null)).toBe(false);
    expect(bordereauRequis(undefined)).toBe(false);
    expect(bordereauRequis('déchèterie')).toBe(false);
  });

  it('exige un `true` STRICT — pas une valeur « à peu près vraie »', () => {
    expect(bordereauRequis({ is_decheterie: 1 })).toBe(false);
    expect(bordereauRequis({ is_decheterie: 'true' })).toBe(false);
  });
});

describe('poidsIndicatifValide', () => {
  it('accepte zéro (déclaration « rien pris »), un entier, un décimal', () => {
    expect(poidsIndicatifValide(0)).toBe(true);
    expect(poidsIndicatifValide(185)).toBe(true);
    expect(poidsIndicatifValide(12.5)).toBe(true);
    expect(poidsIndicatifValide('185')).toBe(true);
    expect(poidsIndicatifValide('12,5')).toBe(true);
  });

  it('refuse une absence, un texte, un négatif, un dépassement', () => {
    expect(poidsIndicatifValide(null)).toBe(false);
    expect(poidsIndicatifValide(undefined)).toBe(false);
    expect(poidsIndicatifValide('')).toBe(false);
    expect(poidsIndicatifValide('beaucoup')).toBe(false);
    expect(poidsIndicatifValide(-1)).toBe(false);
    expect(poidsIndicatifValide(POIDS_INDICATIF_MAX_KG + 1)).toBe(false);
    expect(poidsIndicatifValide(POIDS_INDICATIF_MAX_KG)).toBe(true);
  });

  it('refuse un booléen (Number(true) vaut 1 — piège classique)', () => {
    expect(poidsIndicatifValide(true)).toBe(false);
    expect(poidsIndicatifValide(false)).toBe(false);
  });
});

describe('poidsIndicatifNormalise — NUMERIC(8,1) côté serveur', () => {
  it('arrondit à une décimale', () => {
    expect(poidsIndicatifNormalise(185)).toBe(185);
    expect(poidsIndicatifNormalise(12.46)).toBe(12.5);
    expect(poidsIndicatifNormalise('12,44')).toBe(12.4);
  });

  it('rend null sur une valeur illisible', () => {
    expect(poidsIndicatifNormalise('abc')).toBeNull();
    expect(poidsIndicatifNormalise(null)).toBeNull();
  });
});

describe('validerBordereau', () => {
  const complet = {
    poidsKg: 185,
    signatureAgent: PNG,
    agentAbsentMotif: null,
    signatureChauffeur: PNG,
  };

  it('nominal : les deux signatures et un poids → ok', () => {
    const r = validerBordereau(complet);
    expect(r.ok).toBe(true);
    expect(r.erreurs).toEqual([]);
  });

  it('agent absent AVEC motif → ok (arbitrage client Q2)', () => {
    const r = validerBordereau({ ...complet, signatureAgent: null, agentAbsentMotif: MOTIF_AGENT_INDISPONIBLE });
    expect(r.ok).toBe(true);
  });

  it('agent absent SANS motif → refusé', () => {
    const r = validerBordereau({ ...complet, signatureAgent: null, agentAbsentMotif: null });
    expect(r.ok).toBe(false);
    expect(r.erreurs.join(' ')).toMatch(/agent/i);
  });

  it('un motif inventé ne vaut pas le motif de la liste fermée', () => {
    const r = validerBordereau({ ...complet, signatureAgent: null, agentAbsentMotif: 'il_dejeunait' });
    expect(r.ok).toBe(false);
  });

  it('poids manquant → refusé', () => {
    const r = validerBordereau({ ...complet, poidsKg: null });
    expect(r.ok).toBe(false);
    expect(r.erreurs.join(' ')).toMatch(/poids/i);
  });

  it('poids négatif → refusé', () => {
    expect(validerBordereau({ ...complet, poidsKg: -5 }).ok).toBe(false);
  });

  it('poids au-delà de 60 000 kg → refusé, avec le bon message', () => {
    const r = validerBordereau({ ...complet, poidsKg: 60001 });
    expect(r.ok).toBe(false);
    expect(r.erreurs.join(' ')).toMatch(/60 000/);
  });

  it('poids ZÉRO est accepté — « rien pris » est une déclaration', () => {
    expect(validerBordereau({ ...complet, poidsKg: 0 }).ok).toBe(true);
  });

  it('signature du chauffeur manquante → refusé', () => {
    const r = validerBordereau({ ...complet, signatureChauffeur: null });
    expect(r.ok).toBe(false);
    expect(r.erreurs.join(' ')).toMatch(/chauffeur/i);
  });

  it('une signature qui n’est pas un PNG est traitée comme absente', () => {
    const r = validerBordereau({ ...complet, signatureChauffeur: 'data:image/jpeg;base64,AAAA' });
    expect(r.ok).toBe(false);
  });

  it('remonte TOUTES les erreurs d’un coup (écran FALC)', () => {
    const r = validerBordereau({});
    expect(r.ok).toBe(false);
    expect(r.erreurs).toHaveLength(3); // poids + agent + chauffeur
  });

  it('appelée sans argument, ne plante pas', () => {
    expect(validerBordereau().ok).toBe(false);
  });
});

describe('construirePayloadBordereau — contrat §2.1, au champ près', () => {
  it('produit EXACTEMENT les cinq clés du contrat', () => {
    const corps = construirePayloadBordereau({
      clientId: 'c-1', tourId: 681, cavId: 338,
      poidsKg: 185, signatureAgent: PNG, agentAbsentMotif: null, signatureChauffeur: PNG,
    });
    expect(Object.keys(corps).sort()).toEqual([
      'agent_absent_motif', 'client_id', 'poids_indicatif_kg',
      'signature_agent', 'signature_chauffeur',
    ]);
    expect(corps.client_id).toBe('c-1');
    expect(corps.poids_indicatif_kg).toBe(185);
    expect(corps.signature_chauffeur).toBe(PNG);
    expect(corps.signature_agent).toBe(PNG);
    expect(corps.agent_absent_motif).toBeNull();
  });

  it('ne transporte NI la tournée NI le point : ils sont dans l’URL', () => {
    const corps = construirePayloadBordereau({ tourId: 681, cavId: 338, clientId: 'c', poidsKg: 1, signatureChauffeur: PNG });
    expect(corps.tour_id).toBeUndefined();
    expect(corps.cav_id).toBeUndefined();
  });

  it('agent absent : signature null ET motif présent (les deux, toujours)', () => {
    const corps = construirePayloadBordereau({
      clientId: 'c-2', poidsKg: 40, signatureAgent: null,
      agentAbsentMotif: MOTIF_AGENT_INDISPONIBLE, signatureChauffeur: PNG,
    });
    expect(corps.signature_agent).toBeNull();
    expect(corps.agent_absent_motif).toBe('agent_indisponible');
    // Présents et non « absents » : un champ manquant se confondrait avec un
    // oubli côté serveur.
    expect('signature_agent' in corps).toBe(true);
    expect('agent_absent_motif' in corps).toBe(true);
  });

  it('un motif posé À CÔTÉ d’une signature d’agent est écarté', () => {
    // Le document ne peut pas dire « agent indisponible » sous son paraphe.
    const corps = construirePayloadBordereau({
      clientId: 'c-3', poidsKg: 10, signatureAgent: PNG,
      agentAbsentMotif: MOTIF_AGENT_INDISPONIBLE, signatureChauffeur: PNG,
    });
    expect(corps.signature_agent).toBe(PNG);
    expect(corps.agent_absent_motif).toBeNull();
  });

  it('une signature d’agent mal formée retombe sur le motif', () => {
    const corps = construirePayloadBordereau({
      clientId: 'c-4', poidsKg: 10, signatureAgent: 'oups',
      agentAbsentMotif: MOTIF_AGENT_INDISPONIBLE, signatureChauffeur: PNG,
    });
    expect(corps.signature_agent).toBeNull();
    expect(corps.agent_absent_motif).toBe('agent_indisponible');
  });

  it('le poids ZÉRO part bien comme 0, jamais comme null', () => {
    const corps = construirePayloadBordereau({ clientId: 'c', poidsKg: 0, signatureChauffeur: PNG, agentAbsentMotif: MOTIF_AGENT_INDISPONIBLE });
    expect(corps.poids_indicatif_kg).toBe(0);
    expect(corps.poids_indicatif_kg).not.toBeNull();
  });

  it('survit à un objet vide sans inventer de valeur', () => {
    const corps = construirePayloadBordereau({});
    expect(corps.client_id).toBeNull();
    expect(corps.poids_indicatif_kg).toBeNull();
    expect(corps.signature_chauffeur).toBeNull();
  });
});
