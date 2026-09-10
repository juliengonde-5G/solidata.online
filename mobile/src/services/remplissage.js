/**
 * LES PALIERS DE REMPLISSAGE, tels que le chauffeur les voit et les relit.
 * ═══════════════════════════════════════════════════════════════════════════
 * Cette table vivait dans `pages/FillLevel.jsx`, l'écran de SAISIE. Elle sert
 * désormais aussi à la RESTITUTION (historique de la journée), d'où ce module :
 * une seconde table recopiée dans l'écran d'historique aurait fini par dériver
 * de celle de la saisie, et l'historique aurait alors raconté autre chose que
 * ce que le chauffeur a coché.
 *
 * Elle reste DISTINCTE de celle du serveur (`backend/src/utils/remplissage.js`)
 * pour une raison qui n'a pas changé : ce téléphone travaille HORS LIGNE et ne
 * peut interroger aucun référentiel. Un test de garde côté serveur échoue si
 * les deux cessent de correspondre — elles ne peuvent pas être fusionnées, mais
 * elles ne doivent pas dériver en silence.
 */

// Le backend ne gère que 0-4 sur `fill_level` : 'overflow' mappe sur 4 (plein)
// avec une anomalie 'debordement' automatiquement posée, et le pourcentage
// (110) porte l'information que l'échelle ne sait pas dire.
export const FILL_LEVELS = [
  { value: 0, label: 'vide',          pct: '0%',   visual: 'empty',         store: 0 },
  { value: 6, label: 'un fond',       pct: '10%',  visual: 'empty',         store: 0 },
  { value: 1, label: 'un peu',        pct: '25%',  visual: 'quarter',       store: 1 },
  { value: 2, label: 'à moitié',      pct: '50%',  visual: 'half',          store: 2 },
  { value: 3, label: 'presque plein', pct: '75%',  visual: 'three_quarter', store: 3 },
  { value: 4, label: 'plein',         pct: '100%', visual: 'full',          store: 4 },
  { value: 5, label: 'au-delà',       pct: '++',   visual: 'overflow',      store: 4, overflow: true },
];

/** Pourcentage envoyé au serveur pour un palier affiché. */
export const POURCENTAGE_DEBORDEMENT = 110;

/** `null`, `undefined` et `''` sont des absences ; 0 est une valeur. */
const absent = (v) => v === null || v === undefined || v === '';

/**
 * Ce qu'il faut ÉCRIRE dans l'historique pour un passage déjà envoyé.
 *
 * Le pourcentage prime : lui seul distingue « au-delà » (110 %) de « plein »
 * (100 %). Sans lui, on retombe sur l'échelle 0-4 — et on le dit, parce qu'une
 * borne qui débordait y est indiscernable d'une borne pleine.
 *
 * @returns {string|null} `null` si rien n'a été déclaré (≠ « vide »).
 */
export function libelleRemplissage(fillLevel, fillPercent) {
  if (!absent(fillPercent)) {
    const pct = Number(fillPercent);
    if (Number.isFinite(pct)) {
      const palier = FILL_LEVELS.find((l) => (l.overflow
        ? pct === POURCENTAGE_DEBORDEMENT
        : parseInt(String(l.pct), 10) === pct));
      if (palier?.overflow) return 'au-delà (débordement)';
      if (palier) return `${palier.label} (${palier.pct})`;
      return `${Math.round(pct)} %`;
    }
  }
  if (absent(fillLevel)) return null;
  const niv = Number(fillLevel);
  if (!Number.isFinite(niv)) return null;
  const parNiveau = FILL_LEVELS.find((l) => l.store === niv && !l.overflow);
  return parNiveau ? `${parNiveau.label} (${parNiveau.pct})` : `${niv}/4`;
}
