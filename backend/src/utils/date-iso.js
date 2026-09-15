/**
 * Dates civiles — `Date | chaîne → 'AAAA-MM-JJ'`, une seule fois pour tout le
 * dépôt.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══════════════════════════════════════════
 *
 * `node-pg` rend une colonne `DATE` sous forme d'un objet **`Date`**, pas d'une
 * chaîne. Le raccourci qui paraît innocent —
 *
 *     String(ligne.mois).slice(5, 7)   →  « ar »   →  Number('ar') = NaN
 *     String(ligne.date).slice(0, 10)  →  « Sun Mar 02 »
 *
 * — a coûté quatre défauts à la PR B (rapport 18, D-01 à D-03) : un registre
 * qui n'affichait jamais rien, des dates rendues « Sun Mar 02 » que le
 * navigateur re-datait silencieusement de **2001**, et une sentinelle
 * `'1900-01-01'` comparée en texte que les lettres faisaient passer pour une
 * vraie date. Le dépôt l'avait déjà payé en 2.49.0 (`vak-agenda` comparait
 * `String(date_debut)` au jour courant).
 *
 * ═══ POURQUOI LES ACCESSEURS **LOCAUX**, ET SURTOUT PAS `toISOString()` ═══
 *
 * Le pilote construit l'objet d'une colonne `DATE` à **minuit LOCAL**. Sous un
 * décalage positif (Europe/Paris), `toISOString()` rend donc **la veille** —
 * mesuré :
 *
 *     colonne DATE 2025-07-01 · TZ=UTC            → toISOString 2025-07-01 ✓
 *     colonne DATE 2025-07-01 · TZ=Europe/Paris   → toISOString 2025-06-30 ✗
 *     colonne DATE 2025-07-01 · TZ=Europe/Paris   → getFullYear/Month/Date ✓
 *
 * C'est le défaut D-05 : le module était à une variable `TZ` près de dater
 * faussement chaque ligne d'une pièce de financement. Les conteneurs tournent
 * en UTC aujourd'hui — ce n'est pas une raison de laisser le piège armé.
 *
 * Règle : **les composantes locales, jamais l'UTC**. Elles lisent l'objet dans
 * le repère où le pilote l'a construit, ce qui rend la conversion juste quel
 * que soit le fuseau du processus.
 *
 * ═══ CE QU'IL NE FAIT JAMAIS ══════════════════════════════════════════════
 * Une valeur illisible rend `null` — jamais la date du jour en remplacement,
 * jamais une chaîne tronquée qui ressemble à une date.
 */

'use strict';

/** Fuseau de référence de la structure — les jours civils se lisent à Rouen. */
const FUSEAU_PARIS = 'Europe/Paris';

const deuxChiffres = (n) => String(n).padStart(2, '0');

/**
 * Normalise une date en 'AAAA-MM-JJ'.
 *
 * @param {Date|string|number|null|undefined} v
 * @returns {string|null} 'AAAA-MM-JJ', ou `null` si la valeur est illisible
 */
function isoDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${deuxChiffres(v.getMonth() + 1)}-${deuxChiffres(v.getDate())}`;
  }
  const s = String(v).trim();
  // Le cas de loin le plus fréquent : une chaîne déjà ISO ('2025-03-02',
  // '2025-03-02T10:00:00Z'). On prend le préfixe TEL QUEL plutôt que de le
  // faire transiter par un `Date`, qui lui prêterait un fuseau.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : isoDate(d);
}

/**
 * Le mois civil d'une date, en 1-12 (`null` si illisible).
 * Écrit à part parce que c'est la lecture qui a produit D-01 : on ne découpe
 * plus une chaîne à la main pour obtenir un numéro de mois.
 */
function moisDe(v) {
  const iso = isoDate(v);
  return iso ? Number(iso.slice(5, 7)) : null;
}

/** L'année civile d'une date, en nombre (`null` si illisible). */
function anneeDe(v) {
  const iso = isoDate(v);
  return iso ? Number(iso.slice(0, 4)) : null;
}

/**
 * Le jour civil d'AUJOURD'HUI **à Paris**, en 'AAAA-MM-JJ'.
 *
 * Les conteneurs tournent en UTC : `new Date().toISOString().slice(0, 10)`
 * bascule donc deux heures trop tôt en été, et une fiche remise le 1er à 01 h
 * du matin serait refusée comme « future ». Piège déjà corrigé deux fois dans
 * le dépôt (2.24.1 jour civil des tournées, 2.47.0 horloge du moteur).
 */
function aujourdhuiParis() {
  return jourParis(new Date());
}

/** Le jour civil d'un instant, lu à Paris ('AAAA-MM-JJ'). */
function jourParis(instant) {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  // `en-CA` rend nativement 'AAAA-MM-JJ' ; `Intl` gère le changement d'heure
  // sans aucune table à maintenir.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU_PARIS, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Décale un jour civil 'AAAA-MM-JJ' de N jours, sans jamais passer par un fuseau. */
function decalerJours(iso, n) {
  const base = isoDate(iso);
  if (!base) return null;
  const [y, m, j] = base.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, j));
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return `${d.getUTCFullYear()}-${deuxChiffres(d.getUTCMonth() + 1)}-${deuxChiffres(d.getUTCDate())}`;
}

/**
 * Ajoute N mois à un jour civil 'AAAA-MM-JJ', en arithmétique UTC pure.
 * Le débordement de fin de mois est celui de `Date` (31 août + 6 mois = 2 mars),
 * comportement CONSERVÉ des appelants historiques — seule la dérive de fuseau
 * est corrigée.
 */
function ajouterMois(iso, n) {
  const base = isoDate(iso);
  if (!base) return null;
  const [y, m, j] = base.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, j));
  d.setUTCMonth(d.getUTCMonth() + Number(n || 0));
  return `${d.getUTCFullYear()}-${deuxChiffres(d.getUTCMonth() + 1)}-${deuxChiffres(d.getUTCDate())}`;
}

/**
 * Nombre de jours entiers entre deux jours civils ('AAAA-MM-JJ'), `b - a`.
 * Calcul en `Date.UTC` : aucun changement d'heure ne peut en retirer un.
 */
function ecartJours(a, b) {
  const x = isoDate(a);
  const y = isoDate(b);
  if (!x || !y) return null;
  const ms = (s) => {
    const [an, mo, jo] = s.split('-').map(Number);
    return Date.UTC(an, mo - 1, jo);
  };
  return Math.round((ms(y) - ms(x)) / 86400000);
}

module.exports = {
  isoDate, moisDe, anneeDe, aujourdhuiParis, jourParis,
  decalerJours, ajouterMois, ecartJours, FUSEAU_PARIS,
};
