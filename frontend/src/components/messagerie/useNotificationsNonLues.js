import { useCallback, useMemo, useRef, useState } from 'react';

// ══════════════════════════════════════════
// Notifications (alertes du tableau de bord) — état « lu / non lu »
//
// HONNÊTETÉ SUR LA SOURCE : les alertes viennent de `GET /dashboard/kpis`
// (`res.data.alertes`), recalculées par le serveur à chaque chargement. Elles
// n'ont NI identifiant, NI état de lecture en base — il n'existe aucune API
// d'accusé de lecture pour elles. Le « marquage lu » est donc une commodité
// LOCALE au navigateur (localStorage), comme un onglet replié ou un filtre
// mémorisé : elle n'est jamais transmise au serveur ni partagée entre
// appareils. C'est ce qui permet au compteur du bouton unique de retomber à
// zéro une fois la liste consultée, au lieu d'afficher éternellement le même
// nombre.
//
// Faute d'identifiant, une alerte est reconnue par sa SIGNATURE (type + module
// + texte). Conséquence assumée : si le nombre change (« 1 facture impayée »
// → « 2 factures impayées »), la signature change et l'alerte redevient non
// lue — ce qui est le comportement souhaité, une situation qui s'aggrave
// devant se resignaler.
// ══════════════════════════════════════════

const CLE_STOCKAGE = 'solidata_notifications_lues';
// Borne la mémoire : au-delà, les signatures les plus anciennes sont oubliées
// (elles correspondent à des alertes qui ne sont plus produites).
const MAX_SIGNATURES = 100;

/** Signature stable d'une alerte, à défaut d'identifiant serveur. */
export function signatureAlerte(alerte) {
  if (!alerte) return '';
  return `${alerte.type || alerte.severite || 'info'}|${alerte.module || alerte.categorie || ''}|${alerte.message || ''}`;
}

function lireSignaturesLues() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    const parsed = brut ? JSON.parse(brut) : [];
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    // Navigation privée, stockage bloqué… : on dégrade en « tout est non lu »
    // plutôt que d'empêcher l'affichage.
    return [];
  }
}

/**
 * @param {Array<{type?:string,module?:string,message?:string,link?:string}>} alertes
 * @returns {{ nonLues:number, estNonLue:(a)=>boolean, marquerToutLu:()=>void }}
 */
export default function useNotificationsNonLues(alertes) {
  const [luesArr, setLuesArr] = useState(lireSignaturesLues);

  // Les alertes sont relues via une ref : `marquerToutLu` garde ainsi une
  // identité stable et peut être appelé depuis un effet sans le relancer à
  // chaque rendu.
  const alertesRef = useRef(alertes);
  alertesRef.current = alertes;

  const lues = useMemo(() => new Set(luesArr), [luesArr]);

  const estNonLue = useCallback((alerte) => !lues.has(signatureAlerte(alerte)), [lues]);

  const nonLues = useMemo(
    () => (Array.isArray(alertes) ? alertes.filter((a) => !lues.has(signatureAlerte(a))).length : 0),
    [alertes, lues]
  );

  const marquerToutLu = useCallback(() => {
    const signatures = (alertesRef.current || []).map(signatureAlerte).filter(Boolean);
    if (signatures.length === 0) return;
    setLuesArr((prev) => {
      const manquantes = signatures.filter((s) => !prev.includes(s));
      if (manquantes.length === 0) return prev; // rien de neuf : pas de re-rendu
      const next = [...prev, ...manquantes].slice(-MAX_SIGNATURES);
      try {
        localStorage.setItem(CLE_STOCKAGE, JSON.stringify(next));
      } catch {
        /* stockage indisponible : l'état reste vrai pour la session en cours */
      }
      return next;
    });
  }, []);

  return { nonLues, estNonLue, marquerToutLu };
}
