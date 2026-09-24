/**
 * REJEU D'UNE COLLECTE — calculs purs (aucun appel réseau, aucun état React).
 *
 * La page « Revoir une collecte » rejoue une journée close à partir du compte
 * rendu de tournée (`GET /tours/:id/rapport?gps=rejeu`). Tout ce qui s'affiche
 * à l'instant T se DÉDUIT des horodatages réellement enregistrés :
 *
 *   - la position du camion vient de la trace GPS ; entre deux relevés
 *     rapprochés, elle est interpolée ; au-delà d'un trou de 5 minutes elle
 *     reste au dernier relevé (on ne dessine pas une route que personne n'a
 *     vue passer) ;
 *   - sans trace GPS, le camion est posé sur le dernier point traité — et la
 *     page le DIT : c'est une reconstitution, pas un relevé ;
 *   - un point est « collecté » à partir de son heure réelle de passage ; un
 *     point sans heure réelle ne bascule qu'à la clôture, faute de mieux.
 */

// Au-delà de ce trou entre deux relevés, on n'interpole plus.
const TROU_GPS_MAX_MS = 5 * 60 * 1000;

export const ms = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

const coordOk = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

/** Prépare un rapport pour le rejeu : horodatages en millisecondes, tri. */
export function preparerTournee(rapport) {
  const tour = rapport.tour || {};
  const gps = (rapport.gps_track?.positions || [])
    .map((p) => ({ lat: p.latitude, lng: p.longitude, speed: p.speed, t: ms(p.recorded_at) }))
    .filter((p) => p.t !== null && coordOk(p.lat, p.lng))
    .sort((a, b) => a.t - b.t);
  const points = (rapport.points || []).map((p) => ({ ...p, t: ms(p.actual_time) }));
  const weights = (rapport.weights || []).map((w) => ({ ...w, t: ms(w.recorded_at) }));
  const incidents = (rapport.incidents || []).map((i) => ({ ...i, t: ms(i.created_at) }));
  const messages = (rapport.messages || []).map((m) => ({ ...m, t: ms(m.created_at) }));

  // Bornes : départ et clôture déclarés, élargies par tout ce qui a été
  // horodaté en dehors (un relevé GPS avant le « départ », une pesée après
  // la clôture) — sinon ces événements seraient hors du curseur.
  const temps = [
    ms(tour.started_at), ms(tour.completed_at),
    ...gps.map((p) => p.t), ...points.map((p) => p.t),
    ...weights.map((w) => w.t), ...incidents.map((i) => i.t),
  ].filter((t) => t !== null);
  const debut = temps.length ? Math.min(...temps) : null;
  const fin = temps.length ? Math.max(...temps) : null;

  return {
    id: tour.id,
    rapport,
    tour,
    gps,
    points,
    weights,
    incidents,
    messages,
    debut,
    fin,
    departAt: ms(tour.started_at) ?? debut,
    finAt: ms(tour.completed_at) ?? fin,
  };
}

/** Index du dernier relevé GPS à l'instant T (-1 si aucun). */
function dernierIndex(gps, T) {
  let lo = 0; let hi = gps.length - 1; let res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (gps[mid].t <= T) { res = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return res;
}

/**
 * Position du camion à l'instant T.
 * @returns {{lat,lng,speed,source:'gps'|'points'|'centre', trace:Array<[lat,lng]>}|null}
 */
export function positionA(tr, T, centre) {
  if (tr.gps.length > 0) {
    const i = dernierIndex(tr.gps, T);
    if (i < 0) {
      // Pas encore de relevé : le camion est au centre de tri (ou nulle part).
      return centre ? { lat: centre.latitude, lng: centre.longitude, speed: null, source: 'centre', trace: [] } : null;
    }
    const a = tr.gps[i];
    const trace = tr.gps.slice(0, i + 1).map((p) => [p.lat, p.lng]);
    const b = tr.gps[i + 1];
    if (b && b.t - a.t <= TROU_GPS_MAX_MS && b.t > a.t) {
      const f = (T - a.t) / (b.t - a.t);
      const pos = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
      trace.push([pos.lat, pos.lng]);
      return { ...pos, speed: a.speed, source: 'gps', trace };
    }
    return { lat: a.lat, lng: a.lng, speed: a.speed, source: 'gps', trace };
  }
  // Sans GPS : dernier point traité (horodaté) avant T, sinon le centre.
  const passes = tr.points
    .filter((p) => p.t !== null && p.t <= T && coordOk(p.latitude, p.longitude))
    .sort((x, y) => x.t - y.t);
  const trace = passes.map((p) => [p.latitude, p.longitude]);
  if (centre && coordOk(centre.latitude, centre.longitude)) trace.unshift([centre.latitude, centre.longitude]);
  const dernier = passes[passes.length - 1];
  if (dernier) return { lat: dernier.latitude, lng: dernier.longitude, speed: null, source: 'points', trace };
  return centre ? { lat: centre.latitude, lng: centre.longitude, speed: null, source: 'centre', trace } : null;
}

/** Statut d'un point à l'instant T. */
export function statutPointA(tr, p, T) {
  if (p.t !== null) return T >= p.t ? p.status : 'pending';
  // Aucune heure réelle : l'état final n'est connu qu'à la clôture.
  if (p.status === 'collected' || p.status === 'skipped') {
    return tr.finAt !== null && T >= tr.finAt ? p.status : 'pending';
  }
  return 'pending';
}

/** État synthétique d'une tournée à l'instant T. */
export function etatA(tr, T) {
  const aCollecter = tr.points.filter((p) => p.kind !== 'arret_technique');
  let collectes = 0; let nonCollectes = 0;
  aCollecter.forEach((p) => {
    const s = statutPointA(tr, p, T);
    if (s === 'collected') collectes += 1;
    else if (s === 'skipped') nonCollectes += 1;
  });
  const poids = tr.weights.filter((w) => w.t !== null && w.t <= T)
    .reduce((s, w) => s + (Number(w.weight_kg) || 0), 0);
  const incidents = tr.incidents.filter((i) => i.t !== null && i.t <= T).length;
  let phase = 'en_cours';
  if (tr.departAt !== null && T < tr.departAt) phase = 'pas_partie';
  else if (tr.finAt !== null && T >= tr.finAt) phase = 'terminee';
  const total = aCollecter.length;
  return {
    phase,
    total,
    collectes,
    nonCollectes,
    restants: Math.max(0, total - collectes - nonCollectes),
    avancementPct: total > 0 ? Math.round((collectes / total) * 100) : 0,
    poidsKg: Math.round(poids),
    incidents,
  };
}

/** Journal chronologique de la journée, toutes tournées confondues. */
export function journal(tournees, libelles = {}) {
  const ev = [];
  tournees.forEach((tr) => {
    const base = { tourId: tr.id };
    if (tr.departAt !== null) ev.push({ ...base, t: tr.departAt, type: 'depart', texte: 'Départ du centre de tri' });
    tr.points.forEach((p) => {
      if (p.t === null) return;
      if (p.kind === 'arret_technique') {
        ev.push({ ...base, t: p.t, type: 'arret', texte: `${p.motif_label || 'Arrêt'} — arrivée`, lat: p.latitude, lng: p.longitude });
      } else if (p.status === 'collected') {
        ev.push({ ...base, t: p.t, type: 'collecte', texte: `Collecté : ${p.name || 'point'}`, lat: p.latitude, lng: p.longitude });
      } else if (p.status === 'skipped') {
        ev.push({ ...base, t: p.t, type: 'saut', texte: `Non collecté : ${p.name || 'point'}${p.skip_reason_label ? ` (${p.skip_reason_label})` : ''}`, lat: p.latitude, lng: p.longitude });
      }
    });
    tr.weights.forEach((w) => {
      if (w.t === null) return;
      ev.push({ ...base, t: w.t, type: 'pesee', texte: `Pesée${w.is_intermediate ? ' intermédiaire' : ''} : ${Math.round(Number(w.weight_kg) || 0)} kg` });
    });
    tr.incidents.forEach((i) => {
      if (i.t === null) return;
      const lib = libelles.incident ? libelles.incident(i.type) : i.type;
      ev.push({ ...base, t: i.t, type: 'incident', texte: `Incident : ${lib}${i.description ? ` — ${i.description}` : ''}` });
    });
    tr.messages.forEach((m) => {
      if (m.t === null) return;
      ev.push({ ...base, t: m.t, type: 'message', texte: `Consigne envoyée : ${m.message || ''}` });
    });
    if (tr.finAt !== null && tr.tour.completed_at) ev.push({ ...base, t: tr.finAt, type: 'fin', texte: 'Tournée clôturée' });
  });
  return ev.sort((a, b) => a.t - b.t);
}
