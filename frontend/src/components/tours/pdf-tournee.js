/**
 * Rapport de tournée — PDF d'UNE page A4.
 *
 * Même mécanisme que les autres exports du projet (window.open + print, aucune
 * librairie ajoutée) : le navigateur fait le PDF, on ne fait que lui donner une
 * page correctement composée.
 *
 * La carte est un SVG tracé à la main, sans fond de carte. C'est un choix :
 * des tuiles exigeraient le réseau au moment précis de l'impression, et un fond
 * gris imprimé mange l'encre sans rien apprendre. Ce qui compte ici, c'est la
 * COMPARAISON de deux tracés — le prévisionnel et le réalisé — et elle se lit
 * parfaitement sur un fond blanc.
 *
 * Doctrine du projet : jamais de valeur inventée. Une donnée absente s'affiche
 * « — », un écart non calculable ne vaut pas zéro, et la carte ne se dessine
 * pas si elle n'a rien de vrai à montrer.
 */

import { libelleTypeIncident, libelleStatutIncident } from '../../utils/incidents';

const STRUCTURE = 'Solidarité Textiles';
const VERT = '#2D8C4E';
const VERT_CLAIR = '#8BC540';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cell = (v) => (v == null || v === '' ? '<span class="gris">—</span>' : esc(v));

/**
 * Tronque sans mentir : le « … » dit qu'il manque quelque chose. Sur une
 * demi-colonne, un nom long replierait la ligne sur trois et ferait déborder
 * la page — or c'est la liste ENTIÈRE des points qui doit tenir.
 */
const court = (v, max) => {
  const t = String(v ?? '');
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/**
 * Les points sont nommés « COMMUNE - adresse » dans le référentiel, et la
 * commune est réimprimée juste en dessous : sans cette coupe, chaque ligne du
 * tableau porte deux fois le même mot et passe sur deux lignes pour rien.
 *
 * On ne coupe QUE si la partie gauche du séparateur est exactement la commune —
 * beaucoup de communes contiennent elles-mêmes des tirets (« CAUDEBEC-LÈS-ELBEUF »),
 * et couper au premier tiret venu produirait « LÈS-ELBEUF - 67 rue… ».
 * (Même règle que `mobile/src/services/pointLabel.js`, côté chauffeur.)
 */
const normaliser = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim().toUpperCase();
function sansCommune(nom, commune) {
  const brut = String(nom ?? '').trim();
  if (!brut || !commune) return brut;
  const cible = normaliser(commune);
  if (!cible || !normaliser(brut).startsWith(cible)) return brut;
  for (let i = 0; i < brut.length; i += 1) {
    if (!['-', '–', '—', ':', '·'].includes(brut[i])) continue;
    if (normaliser(brut.slice(0, i)) !== cible) continue;
    return brut.slice(i + 1).trim() || brut;
  }
  return brut;
}

const frDate = (d) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const frHeure = (d) => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};
const fmtDur = (min) => {
  if (min == null || !Number.isFinite(Number(min))) return null;
  const m = Math.round(Number(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};
const nb = (v, unite = '', dec = 0) => {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return `${Number(v).toFixed(dec).replace('.', ',')}${unite ? ` ${unite}` : ''}`;
};

/**
 * Écart à l'horaire prévu, en clair et signé.
 * `null` (et non « 0 min ») quand une des deux heures manque : on ne peut pas
 * mesurer un retard face à une heure qu'on n'a jamais eue.
 */
function ecartTxt(ecartMin) {
  if (ecartMin == null || !Number.isFinite(Number(ecartMin))) return null;
  const m = Math.round(Number(ecartMin));
  if (m === 0) return 'à l’heure';
  return m > 0 ? `+${m} min` : `${m} min`;
}
const ecartClasse = (e) => {
  if (e == null || !Number.isFinite(Number(e))) return '';
  const m = Math.abs(Number(e));
  if (m <= 10) return 'ok';
  return m <= 30 ? 'moyen' : 'fort';
};

// ─────────────────────────────────────────────────────────────────────────────
// CARTE — projection équirectangulaire, corrigée de la convergence des méridiens
// ─────────────────────────────────────────────────────────────────────────────

const estCoord = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

function carteSvg({ previsionnel = [], reel = [], centre = null }, L = 330, H = 235) {
  const prev = (previsionnel || []).filter(estCoord).map((p) => ({ ...p, lat: +p.lat, lng: +p.lng }));
  const trace = (reel || []).filter(estCoord).map((p) => ({ lat: +p.lat, lng: +p.lng }));
  const c = estCoord(centre) ? { lat: +centre.lat, lng: +centre.lng } : null;

  const tous = [...prev, ...trace, ...(c ? [c] : [])];
  if (tous.length < 2) return null; // rien d'honnête à dessiner

  const lats = tous.map((p) => p.lat);
  const lngs = tous.map((p) => p.lng);
  const latMoy = (Math.min(...lats) + Math.max(...lats)) / 2;
  // À 49° de latitude, un degré de longitude vaut ~0,65 degré de latitude en
  // distance : sans cette correction la carte serait étirée d'est en ouest.
  const kx = Math.cos((latMoy * Math.PI) / 180);

  const xMin = Math.min(...lngs) * kx; const xMax = Math.max(...lngs) * kx;
  const yMin = Math.min(...lats); const yMax = Math.max(...lats);
  const pad = 14;
  const eX = (xMax - xMin) || 1e-6; const eY = (yMax - yMin) || 1e-6;
  const ech = Math.min((L - 2 * pad) / eX, (H - 2 * pad) / eY);
  const dx = (L - ech * eX) / 2; const dy = (H - ech * eY) / 2;
  const X = (p) => dx + (p.lng * kx - xMin) * ech;
  const Y = (p) => H - (dy + (p.lat - yMin) * ech); // le nord vers le haut

  const chemin = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ');

  // Échelle : 1 degré de latitude ≈ 111,32 km.
  const kmParPixel = 111.32 / ech;
  const cibles = [0.5, 1, 2, 5, 10, 20, 50];
  const kmEchelle = cibles.find((k) => k / kmParPixel > 45) || cibles[cibles.length - 1];
  const pxEchelle = kmEchelle / kmParPixel;

  const morceaux = [`<rect x="0" y="0" width="${L}" height="${H}" fill="#FBFCFB" stroke="#E2E8F0"/>`];

  if (prev.length > 1) {
    morceaux.push(`<path d="${chemin(prev)}" fill="none" stroke="#94A3B8" stroke-width="1.4"
      stroke-dasharray="5 3" stroke-linejoin="round"/>`);
  }
  if (trace.length > 1) {
    morceaux.push(`<path d="${chemin(trace)}" fill="none" stroke="${VERT}" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`);
  }
  prev.forEach((p, i) => {
    const collecte = p.statut === 'collected';
    morceaux.push(`<circle cx="${X(p).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="5.5"
      fill="${collecte ? VERT_CLAIR : '#FFFFFF'}" stroke="${collecte ? VERT : '#94A3B8'}" stroke-width="1.2"/>`);
    morceaux.push(`<text x="${X(p).toFixed(1)}" y="${(Y(p) + 2.4).toFixed(1)}" text-anchor="middle"
      font-size="6.5" font-weight="700" fill="${collecte ? '#14532D' : '#64748B'}">${i + 1}</text>`);
  });
  if (c) {
    morceaux.push(`<rect x="${(X(c) - 5).toFixed(1)}" y="${(Y(c) - 5).toFixed(1)}" width="10" height="10"
      fill="#1E293B" rx="1.5"/>`);
    morceaux.push(`<text x="${X(c).toFixed(1)}" y="${(Y(c) - 8).toFixed(1)}" text-anchor="middle"
      font-size="6" font-weight="700" fill="#1E293B">CENTRE</text>`);
  }
  morceaux.push(`<g transform="translate(${pad},${H - 10})">
    <line x1="0" y1="0" x2="${pxEchelle.toFixed(1)}" y2="0" stroke="#475569" stroke-width="1.2"/>
    <line x1="0" y1="-3" x2="0" y2="3" stroke="#475569" stroke-width="1.2"/>
    <line x1="${pxEchelle.toFixed(1)}" y1="-3" x2="${pxEchelle.toFixed(1)}" y2="3" stroke="#475569" stroke-width="1.2"/>
    <text x="${(pxEchelle / 2).toFixed(1)}" y="-5" text-anchor="middle" font-size="6" fill="#475569">${String(kmEchelle).replace('.', ',')} km</text>
  </g>`);

  return `<svg viewBox="0 0 ${L} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg">${morceaux.join('')}</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────

const STYLES = `
@page { size: A4 portrait; margin: 9mm 9mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8.5px; color: #0F172A; line-height: 1.35; }
.gris { color: #94A3B8; }
.bandeau { background: ${VERT}; color: #fff; padding: 8px 12px; display: flex; justify-content: space-between; align-items: flex-end; }
.bandeau h1 { font-size: 15px; font-weight: 800; letter-spacing: -.2px; }
.bandeau .sub { font-size: 8.5px; opacity: .92; }
.identite { display: flex; flex-wrap: wrap; gap: 0 16px; padding: 5px 12px; background: #F1F5F4; border-bottom: 1px solid #E2E8F0; }
.identite div { font-size: 8px; }
.identite b { color: #334155; }
.kpis { display: flex; gap: 5px; margin: 7px 0; }
.kpi { flex: 1; border: 1px solid #E2E8F0; border-radius: 5px; padding: 4px 6px; }
.kpi .l { font-size: 6.5px; text-transform: uppercase; letter-spacing: .4px; color: #64748B; font-weight: 700; }
.kpi .v { font-size: 13px; font-weight: 800; color: #0F172A; line-height: 1.15; }
.kpi .n { font-size: 6.5px; color: #94A3B8; }
.kpi.alerte .v { color: #B91C1C; }
.cols { display: flex; gap: 8px; align-items: flex-start; }
.col-g { flex: 0 0 57%; } .col-d { flex: 1; }
.cols-dense .col-g { flex: 0 0 67%; }
.cols-dense table.dense td { line-height: 1.15; }
h2 { font-size: 8px; text-transform: uppercase; letter-spacing: .6px; color: ${VERT}; font-weight: 800;
     border-bottom: 1px solid #D1DBD4; padding-bottom: 2px; margin: 7px 0 3px; }
h2:first-child { margin-top: 0; }
table { width: 100%; border-collapse: collapse; }
th { font-size: 6.5px; text-transform: uppercase; letter-spacing: .3px; color: #64748B; text-align: left;
     padding: 2px 3px; border-bottom: 1px solid #CBD5E1; font-weight: 700; }
td { padding: 1.6px 3px; border-bottom: 1px solid #F1F5F9; vertical-align: top; }
td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.deux-col { display: flex; gap: 6px; align-items: flex-start; }
.deux-col > table { flex: 1; min-width: 0; }
table.dense { font-size: 6.6px; }
table.dense th { font-size: 5.6px; padding: 1px 2px; }
table.dense td { padding: 0.7px 2px; }
table.dense .etat { font-size: 5.6px; }
table.dense td span.gris[style] { display: none; }
.rang { color: #94A3B8; font-weight: 700; }
.ok { color: #15803D; } .moyen { color: #B45309; } .fort { color: #B91C1C; font-weight: 700; }
.etat { font-size: 6.5px; padding: 0 3px; border-radius: 3px; white-space: nowrap; }
.e-collected { background: #DCFCE7; color: #166534; }
.e-skipped { background: #FEF3C7; color: #92400E; }
.e-incident { background: #FEE2E2; color: #991B1B; }
.e-pending { background: #F1F5F9; color: #64748B; }
.e-arret { background: #E0E7FF; color: #3730A3; }
.legende { display: flex; gap: 10px; font-size: 6.5px; color: #475569; margin-top: 2px; }
.legende i { display: inline-block; width: 13px; height: 0; border-top-width: 2px; vertical-align: middle; margin-right: 3px; }
.note { font-size: 6.5px; color: #94A3B8; margin-top: 2px; font-style: italic; }
.bloc { border: 1px solid #E2E8F0; border-radius: 5px; padding: 4px 6px; margin-top: 3px; font-size: 7.5px; }
.bloc.rouge { border-color: #FECACA; background: #FEF2F2; }
.bloc .t { font-weight: 700; color: #334155; }
.bloc .h { float: right; color: #94A3B8; font-size: 6.5px; }
.pied { margin-top: 7px; padding-top: 4px; border-top: 1px solid #E2E8F0; font-size: 6.5px; color: #94A3B8;
        display: flex; justify-content: space-between; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

const ETAT_LABELS = {
  collected: 'Collecté', skipped: 'Non collecté', incident: 'Incident',
  pending: 'Non fait', done: 'Fait', arret: 'Arrêt',
};

function ligneKpi(label, valeur, note = null, alerte = false) {
  return `<div class="kpi${alerte ? ' alerte' : ''}"><div class="l">${esc(label)}</div>`
    + `<div class="v">${valeur == null ? '<span class="gris">—</span>' : esc(valeur)}</div>`
    + `${note ? `<div class="n">${esc(note)}</div>` : ''}</div>`;
}

/**
 * Le tableau des points, en UNE ou DEUX colonnes selon leur nombre.
 *
 * Une tournée de bornes en compte couramment 40 à 75 : sur une seule colonne,
 * la page en déborde et la promesse « un rapport, une page » tombe. Plutôt que
 * de tronquer la liste — c'est le DÉTAIL DE LA COLLECTE qui est demandé, pas un
 * extrait —, on la coupe en deux colonnes côte à côte et on resserre les lignes.
 * Le seuil est mesuré, pas deviné : au-delà, le rendu A4 déborde.
 */
const SEUIL_DEUX_COLONNES = 26;

function tableauPoints(points) {
  if (!points || points.length === 0) return '<p class="gris">Aucun point au programme.</p>';
  if (points.length > SEUIL_DEUX_COLONNES) {
    const milieu = Math.ceil(points.length / 2);
    // Les rangs sont calculés sur la liste ENTIÈRE avant la coupe : la seconde
    // colonne continue la numérotation, elle ne recommence pas à 1.
    return `<div class="deux-col">${unTableau(points.slice(0, milieu), true)}`
      + `${unTableau(points.slice(milieu), true)}</div>`;
  }
  return unTableau(points, false);
}

function unTableau(points, dense) {
  const lignes = points.map((p, i) => {
    const prevu = frHeure(p.heure_prevue);
    const reel = frHeure(p.heure_reelle);
    const e = ecartTxt(p.ecart_min);
    const etatCle = p.est_arret ? 'arret' : (p.statut || 'pending');
    const etat = p.est_arret ? (p.motif_libelle || 'Arrêt') : (ETAT_LABELS[p.statut] || p.statut || '—');
    return `<tr>
      <td class="rang">${p.rang ?? i + 1}</td>
      <td>${esc(court(sansCommune(p.nom, p.commune) || p.nom || '—', dense ? 24 : 60))}${p.commune && !dense ? `<br><span class="gris" style="font-size:6.5px">${esc(p.commune)}</span>` : ''}
          ${p.motif_non_collecte ? `<br><span class="moyen" style="font-size:6.5px">${esc(p.motif_non_collecte)}</span>` : ''}</td>
      <td class="num">${prevu ? esc(prevu) : '<span class="gris">—</span>'}</td>
      <td class="num">${reel ? esc(reel) : '<span class="gris">—</span>'}</td>
      <td class="num ${ecartClasse(p.ecart_min)}">${e ? esc(e) : '<span class="gris">—</span>'}</td>
      <td><span class="etat e-${etatCle}">${esc(etat)}</span></td>
      ${dense ? '' : `<td class="num">${p.remplissage_pct != null ? `${esc(Math.round(Number(p.remplissage_pct)))} %` : '<span class="gris">—</span>'}</td>`}
    </tr>`;
  }).join('');
  // En mode dense, la colonne est deux fois plus étroite : le remplissage et la
  // commune passent à la trappe plutôt que de replier chaque ligne sur trois.
  return `<table class="${dense ? 'dense' : ''}"><thead><tr>
      <th style="width:12px">#</th><th>Point</th><th style="width:24px">Prévu</th>
      <th style="width:24px">Réel</th><th style="width:32px">Écart</th>
      <th style="width:40px">État</th>${dense ? '' : '<th style="width:28px">Rempl.</th>'}
    </tr></thead><tbody>${lignes}</tbody></table>`;
}

/**
 * SEUL point de contact entre le contrat de `GET /api/tours/:id/rapport` et la
 * composition de la page.
 *
 * Le serveur nomme ses données en anglais, comme tous ses voisins
 * (`live-summary`, `active-summary`) ; la page, elle, est écrite dans la langue
 * qu'elle imprime. Plutôt que de disséminer les deux vocabulaires dans cent
 * lignes de gabarit, la traduction se fait ICI, une fois, à la frontière. Le
 * jour où l'API bouge, c'est cette fonction qu'on relit — pas le HTML.
 *
 * Aucune valeur n'est fabriquée au passage : ce que le serveur ne sait pas
 * reste `null`, et s'imprimera « — ».
 */
export function depuisApi(rep) {
  const r = rep || {};
  const t = r.tour || {};
  const k = r.kpis || {};
  const gps = r.gps_track || {};

  return {
    tournee: {
      id: t.id ?? null,
      date: t.date ?? null,
      statut: t.status ?? null,
      collection_type: t.collection_type ?? null,
      debut_reel: t.started_at ?? null,
      fin_reelle: t.completed_at ?? null,
      km_start: t.km_start ?? null,
      km_end: t.km_end ?? null,
      // Le véhicule porte l'identité de la session chauffeur : son immatriculation
      // est ce que le gestionnaire reconnaît, le nom commercial n'est qu'un appoint.
      vehicule: t.vehicle
        ? [t.vehicle.registration, t.vehicle.name].filter(Boolean).join(' — ') || null
        : null,
      // `null` assumé et fréquent : une tournée peut partir sans chauffeur
      // nominatif (« 1 URL = 1 véhicule »), ce n'est pas une donnée manquante.
      chauffeur: (t.driver && t.driver.name) || null,
      suiveurs: (t.suiveurs || []).map((s) => s && s.name).filter(Boolean),
    },
    indicateurs: {
      duree_reelle_min: k.duration_min ?? null,
      duree_estimee_min: k.estimated_duration_min ?? null,
      distance_reelle_km: k.distance_km ?? null,
      distance_estimee_km: k.estimated_distance_km ?? null,
      poids_total_kg: k.total_weight_kg ?? null,
      poids_motif: k.total_weight_motif ?? null,
      poids_source: k.total_weight_source ?? null,
    },
    points: (r.points || []).map((p) => ({
      rang: p.rank ?? null,
      est_arret: p.kind === 'arret_technique',
      nom: p.name ?? null,
      commune: p.commune ?? null,
      statut: p.status ?? null,
      heure_prevue: p.planned_passage_time ?? null,
      heure_reelle: p.actual_time ?? p.completed_at ?? null,
      ecart_min: p.delay_minutes ?? null,
      // Le remplissage est servi en POURCENTAGE (l'échelle 0-5 du chauffeur y a
      // déjà été convertie, `fill_source` disant laquelle des deux a servi).
      remplissage_pct: p.fill_effective_percent ?? null,
      motif_non_collecte: p.skip_reason_label ?? null,
      motif_libelle: p.motif_label ?? null,
      lat: p.latitude ?? null,
      lng: p.longitude ?? null,
    })),
    pesees: (r.weights || []).map((w) => ({
      heure: w.recorded_at ?? null,
      poids_kg: w.weight_kg ?? null,
      intermediaire: !!w.is_intermediate,
    })),
    incidents: (r.incidents || []).map((i) => ({
      heure: i.created_at ?? null,
      type: i.type ?? null,
      type_libelle: libelleTypeIncident(i.type),
      statut: i.status ?? null,
      statut_libelle: libelleStatutIncident(i.status),
      description: i.description ?? null,
      resolution: i.resolution_notes ?? null,
    })),
    messages: (r.messages || []).map((m) => ({
      heure: m.created_at ?? null,
      // `driver_messages` ne va que du gestionnaire vers le chauffeur : il n'y a
      // pas de voie retour dans le logiciel, et le rapport ne fait pas semblant.
      sens: 'gestionnaire',
      texte: m.message ?? null,
      lu_le: m.read_at ?? null,
    })),
    trace_gps: (gps.positions || []).map((g) => ({ lat: g.latitude, lng: g.longitude })),
    nb_positions_gps: gps.total_positions ?? null,
    centre_tri: (r.planned_route && r.planned_route.centre_tri)
      ? { lat: r.planned_route.centre_tri.latitude, lng: r.planned_route.centre_tri.longitude }
      : null,
  };
}

/**
 * Construit la page HTML complète du rapport. Fonction PURE (aucun accès au
 * DOM, aucune fenêtre) : c'est elle qui porte toute la composition, et c'est
 * elle qu'on peut rendre hors navigateur pour vérifier que le rapport tient
 * bien sur UNE page A4 — une promesse qui ne se vérifie pas à l'œil nu.
 */
export function construireRapportHtml(r) {
  const t = (r && r.tournee) || {};
  const k = (r && r.indicateurs) || {};
  const points = (r && r.points) || [];
  const pesees = (r && r.pesees) || [];
  const incidents = (r && r.incidents) || [];
  const messages = (r && r.messages) || [];

  const collectes = points.filter((p) => p.statut === 'collected').length;
  const nbPoints = points.filter((p) => !p.est_arret).length;

  // Écart moyen : calculé sur les seuls points RÉELLEMENT comparables. Un point
  // sans heure prévue ou sans heure réelle n'entre pas dans la moyenne — il n'a
  // pas d'écart nul, il n'a pas d'écart du tout.
  const ecarts = points.map((p) => p.ecart_min).filter((e) => e != null && Number.isFinite(Number(e))).map(Number);
  const ecartMoyen = ecarts.length ? Math.round(ecarts.reduce((a, b) => a + b, 0) / ecarts.length) : null;

  const carte = carteSvg({
    previsionnel: points.filter((p) => !p.est_arret),
    reel: (r && r.trace_gps) || [],
    centre: (r && r.centre_tri) || null,
  });

  const identite = [
    ['Véhicule', t.vehicule || null],
    ['Chauffeur', t.chauffeur || null],
    ['Équipage', (t.suiveurs && t.suiveurs.length) ? t.suiveurs.join(', ') : null],
    ['Type', t.collection_type === 'association' ? 'Collecte associations' : 'Collecte de bornes'],
    ['Départ', frHeure(t.debut_reel)],
    ['Retour', frHeure(t.fin_reelle)],
    ['Km', (t.km_start != null && t.km_end != null) ? `${t.km_start} → ${t.km_end}` : null],
  ].map(([l, v]) => `<div><b>${esc(l)} :</b> ${cell(v)}</div>`).join('');

  const kpis = [
    ligneKpi('Durée réelle', fmtDur(k.duree_reelle_min), k.duree_estimee_min != null ? `estimée ${fmtDur(k.duree_estimee_min)}` : null),
    ligneKpi('Distance', nb(k.distance_reelle_km, 'km', 1), k.distance_estimee_km != null ? `estimée ${nb(k.distance_estimee_km, 'km', 1)}` : 'aucun relevé GPS'),
    ligneKpi('Points collectés', `${collectes}/${nbPoints}`),
    ligneKpi('Poids total', nb(k.poids_total_kg, 'kg'), pesees.length > 1 ? `${pesees.length} pesées` : null),
    ligneKpi('Écart moyen', ecartMoyen != null ? ecartTxt(ecartMoyen) : null,
      ecarts.length ? `sur ${ecarts.length} point${ecarts.length > 1 ? 's' : ''}` : 'non mesurable'),
    ligneKpi('Incidents', incidents.length || '0', null, incidents.length > 0),
  ].join('');

  // Ne jamais écrire « aucune pesée » sous un poids total affiché : la page se
  // contredirait. Quand le total vient de la tournée et non d'une pesée
  // détaillée (reprise manuelle, import, historique d'avant la pesée mobile),
  // on le DIT — c'est une provenance, pas une absence.
  const blocPesees = pesees.length === 0
    ? `<p class="gris" style="font-size:7.5px">${esc(k.poids_motif || 'Aucune pesée enregistrée.')}</p>`
    : `<table><tbody>${pesees.map((p) => `<tr>
        <td class="num" style="width:30px">${cell(frHeure(p.heure))}</td>
        <td class="num"><b>${nb(p.poids_kg, 'kg') || '—'}</b></td>
        <td class="gris" style="font-size:6.5px">${p.intermediaire ? 'intermédiaire' : 'finale'}</td>
      </tr>`).join('')}</tbody></table>`;

  const blocIncidents = incidents.length === 0 ? '<p class="gris" style="font-size:7.5px">Aucun événement déclaré.</p>'
    : incidents.map((i) => `<div class="bloc rouge">
        <span class="h">${cell(frHeure(i.heure))}</span>
        <span class="t">${esc(i.type_libelle || i.type || 'Événement')}</span>
        ${i.description ? `<div>${esc(i.description)}</div>` : ''}
        <div class="gris">Statut : ${esc(i.statut_libelle || i.statut || '—')}${i.resolution ? ` · ${esc(i.resolution)}` : ''}</div>
      </div>`).join('');

  const blocMessages = messages.length === 0 ? '<p class="gris" style="font-size:7.5px">Aucun message échangé.</p>'
    : messages.map((m) => `<div class="bloc">
        <span class="h">${cell(frHeure(m.heure))}</span>
        <span class="t">${m.sens === 'chauffeur' ? 'Chauffeur' : 'Gestionnaire'}</span>
        <div>${esc(m.texte || '—')}</div>
        ${m.lu_le ? `<div class="gris">Lu à ${esc(frHeure(m.lu_le) || '—')}</div>` : ''}
      </div>`).join('');

  const blocCarte = carte
    ? `${carte}
       <div class="legende">
         <span><i style="border-top:2px dashed #94A3B8"></i>Prévisionnel (ordre de passage)</span>
         <span><i style="border-top:2px solid ${VERT}"></i>Trajet réellement parcouru</span>
       </div>
       <p class="note">Le tracé prévisionnel relie les points dans l'ordre planifié, à vol d'oiseau : il montre
       l'ordre, pas les rues empruntées. Le trajet réalisé vient des relevés GPS du véhicule${
         (r && r.nb_positions_gps) ? ` (${r.nb_positions_gps} positions enregistrées)` : ''}.</p>`
    : '<p class="gris" style="font-size:7.5px">Carte non traçable : ni coordonnées de points ni relevés GPS exploitables.</p>';

  const corps = `
    <div class="identite">${identite}</div>
    <div class="kpis">${kpis}</div>
    <div class="cols${points.length > SEUIL_DEUX_COLONNES ? ' cols-dense' : ''}">
      <div class="col-g">
        <h2>Détail de la collecte</h2>
        ${tableauPoints(points)}
      </div>
      <div class="col-d">
        <h2>Itinéraire — prévu et réalisé</h2>
        ${blocCarte}
        <h2>Pesées au centre de tri</h2>
        ${blocPesees}
        <h2>Événements déclarés</h2>
        ${blocIncidents}
        <h2>Messages avec le gestionnaire</h2>
        ${blocMessages}
      </div>
    </div>
    <div class="pied">
      <span>${esc(STRUCTURE)} — rapport de tournée n° ${esc(t.id ?? '—')}</span>
      <span>Édité le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>`;

  const bandeau = `<div class="bandeau">
      <div><h1>Rapport de tournée n° ${esc(t.id ?? '—')}</h1>
      <div class="sub">${esc(frDate(t.date))}</div></div>
      <div style="text-align:right"><div class="sub">${esc(STRUCTURE)}</div>
      <div class="sub">${esc(t.statut === 'completed' ? 'Tournée terminée' : t.statut || '')}</div></div>
    </div>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/>`
    + `<title>Rapport tournee ${esc(t.id ?? '')}</title><style>${STYLES}</style></head>`
    + `<body>${bandeau}${corps}</body></html>`;
}

/** Ouvre la fenêtre d'impression du navigateur sur le rapport. */
export function printRapportTournee(r) {
  if (!r) return;
  const w = window.open('', '_blank', 'width=880,height=1180');
  if (!w) { alert('Popup bloquée — autorisez les popups pour générer le PDF.'); return; }
  w.document.write(construireRapportHtml(depuisApi(r)));
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// Exportés pour les tests : ce sont des règles, pas des détails de mise en page.
export { ecartTxt, carteSvg };
