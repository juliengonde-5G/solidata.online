/**
 * Mise en forme, côté écran chauffeur, des horaires d'accessibilité et des
 * rendez-vous d'un point association (chantier tournées associations,
 * 26/08/2026 — RG-A8 « horaires du jour » et RG-B6 « rendez-vous »).
 *
 * Module PUR : aucun accès réseau, aucune horloge implicite. Le « jour » est
 * déjà résolu côté serveur (`horaires_jour` ne contient que les plages
 * d'AUJOURD'HUI, voir le contrat technique du chantier §1/§4.1 — le champ
 * `rdv` porte l'éventuel rendez-vous du passage). Isolé de TourMap.jsx et
 * FillLevel.jsx (qui embarquent Leaflet/Socket.IO, non testables sans mock
 * lourd — Leaflet exige `document` dès son import) pour rester testable
 * unitairement, comme services/pointLabel.js et services/cavPhoto.js.
 *
 * Sémantique des TROIS ÉTATS de `horaires_jour` — NE JAMAIS LES CONFONDRE
 * (une confusion ici produit un écran qui rassure à tort ou inquiète à
 * tort) :
 *   - `undefined` (champ pas encore renvoyé par un backend en cours de
 *     déploiement) ou `null` (horaires non renseignés sur la fiche) →
 *     information INCONNUE → on n'affiche RIEN. Une fausse assurance
 *     (« ouvert » ou même « horaires inconnus » en gros) est pire que le
 *     silence pour un chauffeur en tournée.
 *   - `[]` (tableau vide) → le point est FERMÉ aujourd'hui.
 *   - tableau non vide de plages → le point est OUVERT aux heures données.
 */

/**
 * 'HH:MM' ou 'HH:MM:SS' (colonne TIME PostgreSQL) → écriture FALC courte
 * (« 9h », « 14h05 »). Les minutes à zéro sont tues (« 9h », pas « 9h00 »),
 * comme on le dit à l'oral. `null` si la valeur est illisible — jamais
 * d'heure inventée.
 * @param {*} hhmm
 * @returns {string|null}
 */
export function formatHeureFalc(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^([0-2]?\d):([0-5]\d)/);
  if (!m) return null;
  const heure = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (heure > 23) return null;
  return minute === 0 ? `${heure}h` : `${heure}h${String(minute).padStart(2, '0')}`;
}

/**
 * Une plage {debut, fin} → « 9h–12h ». `null` si l'une des deux bornes est
 * illisible (jamais de plage à moitié inventée).
 * @param {{debut:string, fin:string}} plage
 * @returns {string|null}
 */
export function formatPlageFalc(plage) {
  if (!plage || typeof plage !== 'object') return null;
  const debut = formatHeureFalc(plage.debut);
  const fin = formatHeureFalc(plage.fin);
  if (!debut || !fin) return null;
  return `${debut}–${fin}`; // en-dash, comme l'exemple du CDC : « 9h–12h »
}

/**
 * Décide ce qu'il faut afficher sur l'écran chauffeur pour les horaires du
 * jour d'un point association — et surtout ce qu'il ne faut PAS afficher.
 *
 * @param {Array<{debut:string,fin:string}>|null|undefined} horairesJour
 * @returns {{etat:'ouvert'|'ferme', texte:string}|null} `null` = ne rien
 *   afficher (horaires inconnus, ou payload non arrivé/mal formé).
 */
export function infoHorairesJour(horairesJour) {
  // undefined (champ absent du payload, backend pas encore à jour) et null
  // (horaires non renseignés en fiche) se traitent EXACTEMENT pareil ici :
  // information inconnue, silence côté écran.
  if (horairesJour == null) return null;
  if (!Array.isArray(horairesJour)) return null; // forme inattendue → rien d'inventé

  if (horairesJour.length === 0) {
    return {
      etat: 'ferme',
      texte: "Fermé aujourd'hui — le passage a été forcé par le bureau",
    };
  }

  const plages = horairesJour.map(formatPlageFalc).filter(Boolean);
  // Toutes les plages étaient illisibles : anomalie de données, pas un vrai
  // jour fermé ni un vrai jour ouvert — on n'invente ni l'un ni l'autre.
  if (plages.length === 0) return null;

  return { etat: 'ouvert', texte: `Ouvert aujourd'hui : ${plages.join(' · ')}` };
}

/**
 * Texte du bandeau rendez-vous (« Rendez-vous à 10h30 » ou, pour un créneau,
 * « Rendez-vous entre 10h et 10h30 »). `null` si le point n'a pas de
 * rendez-vous, ou si le payload ne le porte pas encore.
 * @param {{heure_debut:string, heure_fin?:string, tolerance_min?:number}|null|undefined} rdv
 * @returns {string|null}
 */
export function texteRdv(rdv) {
  if (!rdv || typeof rdv !== 'object') return null;
  const debut = formatHeureFalc(rdv.heure_debut);
  if (!debut) return null;
  const fin = formatHeureFalc(rdv.heure_fin);
  if (fin && fin !== debut) return `Rendez-vous entre ${debut} et ${fin}`;
  return `Rendez-vous à ${debut}`;
}
