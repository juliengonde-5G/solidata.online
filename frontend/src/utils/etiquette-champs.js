// Contenu des cases de l'étiquette carton A4 (modèle 2.59.0, croquis client du
// 25/09/2026) — fonctions PURES, séparées du rendu pour que la règle de chaque
// case se lise en un seul endroit.

const TZ = 'Europe/Paris';

/**
 * « Code vérif » : la RÉFÉRENCE COURTE du carton, c'est-à-dire ce qui distingue
 * deux cartons identiques. Code v2 (13 hex) : ses 6 derniers caractères, la
 * référence de colis. Ancien code court (≤ 8 caractères, ex. P10AAH) : le code
 * entier — il est déjà court et le tronquer le rendrait ambigu. Ancien code
 * long (horodaté, balance) : ses 6 derniers caractères.
 */
export function referenceCourte(code) {
  const c = String(code ?? '').trim();
  if (!c) return '';
  if (/^[0-9A-F]{13}$/i.test(c)) return c.slice(-6).toUpperCase();
  if (c.length <= 8) return c;
  return c.slice(-6);
}

/**
 * Date de création de l'étiquette. Une réimpression garde la date du carton :
 * c'est le carton qui est daté, pas la feuille.
 */
export function dateEtiquette(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function heureEtiquette(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

function normaliser(v) {
  return String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Pastille de saison (croquis : « Jaune = Été, Hiver = Bleu »). « Sans Saison »
 * n'a PAS de pastille : un carton qui se vend toute l'année n'a pas de couleur,
 * et une teinte grise se lirait comme une saison de plus. Les saisons
 * historiques du stock importé gardent une couleur distincte.
 */
export function couleurSaison(saison) {
  const n = normaliser(saison);
  if (!n || n.includes('sans')) return null;
  if (n.includes('ete')) return { fond: '#FACC15', nom: 'Jaune' };
  if (n.includes('hiver')) return { fond: '#2563EB', nom: 'Bleu' };
  if (n.includes('printemps')) return { fond: '#22C55E', nom: 'Vert' };
  if (n.includes('automne')) return { fond: '#EA580C', nom: 'Orange' };
  return null;
}

/** Taille de police du produit : un nom long doit tenir sur la case. */
export function taillePoliceProduit(nom) {
  const n = String(nom ?? '').length;
  if (n <= 14) return 60;
  if (n <= 22) return 48;
  if (n <= 32) return 38;
  if (n <= 45) return 30;
  return 24;
}
