import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { MapContainer, Marker, Popup, Polyline, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  History as HistoryIcon, Truck, MapPin, Gauge, Scale, Play, Pause, SkipBack, SkipForward,
  ChevronLeft, ChevronRight, AlertTriangle, FileText,
} from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, MapSizeFix } from '../components';
import FondCarte from '../components/FondCarte';
import api from '../services/api';
import { libelleStatutPoint } from '../utils/tours';
import { libelleTypeIncident } from '../utils/incidents';
import {
  preparerTournee, positionA, statutPointA, etatA, journal,
} from '../utils/rejeu';

/**
 * REVOIR UNE COLLECTE — le pendant de « Collecte en direct » pour une journée
 * CLOSE (demande client 24/09/2026).
 *
 * Même carte, mêmes couleurs par tournée, mêmes indicateurs — mais pilotés par
 * un curseur de temps au lieu de l'horloge : on rejoue la journée, en accéléré
 * ou pas à pas, et chaque événement du journal ramène le curseur à son heure.
 *
 * Source : le compte rendu de tournée (`/tours/:id/rapport?gps=rejeu`), qui
 * rassemble déjà tout ce qui a été horodaté — points, pesées, incidents,
 * consignes, trace GPS. Aucune donnée n'est recalculée ici : l'écran ne fait
 * que dire, pour un instant donné, ce qui était déjà arrivé. Chaque ouverture
 * est journalisée au registre RGPD comme une consultation du compte rendu
 * (même surface : positions horodatées et conducteur nommé).
 */

// Palette identique à « Collecte en direct » : une tournée garde sa couleur
// d'un écran à l'autre.
const TOUR_COLORS = ['#0D9488', '#6366F1', '#F59E0B', '#EC4899', '#8B5CF6', '#10B981', '#EF4444', '#F97316', '#06B6D4', '#84CC16', '#A855F7', '#14B8A6'];
const VITESSES = [10, 30, 60, 120, 300, 600];

const COULEUR_POINT = {
  collected: '#10B981',
  skipped: '#F59E0B',
  incident: '#EF4444',
};

const ICONES_EVENEMENT = {
  depart: '🚛', collecte: '✅', saut: '⚠️', arret: '🏭', pesee: '⚖️', incident: '🚨', message: '💬', fin: '🏁',
};

function truckIcon(color, estompe) {
  return new L.DivIcon({
    html: `<div style="background:${color};opacity:${estompe ? 0.55 : 1};color:white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">🚛</div>`,
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function centreTriIcon() {
  return new L.DivIcon({
    html: '<div style="background:#1E293B;color:white;border-radius:8px;width:32px;height:32px;'
        + 'display:flex;align-items:center;justify-content:center;font-size:16px;'
        + 'border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.45)">🏭</div>',
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// Jour civil de Paris (le conteneur et le navigateur peuvent ne pas y être).
function jourParis(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
}
function decalerJour(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtHeure(t, secondes = false) {
  if (t === null || t === undefined) return '—';
  return new Date(t).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', ...(secondes ? { second: '2-digit' } : {}), timeZone: 'Europe/Paris',
  });
}
function fmtDuree(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

const PHASES = {
  pas_partie: { label: 'Pas encore partie', classe: 'bg-slate-100 text-slate-600' },
  en_cours: { label: 'En cours', classe: 'bg-blue-100 text-blue-700' },
  terminee: { label: 'Terminée', classe: 'bg-emerald-100 text-emerald-700' },
};

/** Cadre la carte sur la journée une fois les données chargées. */
function Cadrage({ bornes }) {
  const map = useMap();
  useEffect(() => {
    if (bornes && bornes.length > 1) map.fitBounds(bornes, { padding: [30, 30], maxZoom: 14 });
  }, [map, bornes]);
  return null;
}

export default function CollecteRejeu() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [date, setDate] = useState(searchParams.get('date') || jourParis());
  const tourDemande = searchParams.get('tour') ? Number(searchParams.get('tour')) : null;

  const [liste, setListe] = useState([]);
  const [chargementListe, setChargementListe] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [selection, setSelection] = useState([]);
  const [rapports, setRapports] = useState({});
  const [chargementRapports, setChargementRapports] = useState(false);
  const [echecs, setEchecs] = useState([]);
  // Comptes rendus déjà demandés : un échec n'est pas redemandé en boucle.
  const demandesRef = useRef(new Set());

  const [T, setT] = useState(null);
  const [lecture, setLecture] = useState(false);
  const [vitesse, setVitesse] = useState(60);
  const journalRef = useRef(null);

  // ── Liste des tournées TERMINÉES du jour ────────────────────────────────
  useEffect(() => {
    let annule = false;
    setChargementListe(true);
    setErreur(null);
    setLecture(false);
    setT(null);
    api.get('/tours', { params: { date, status: 'completed' } })
      .then((res) => {
        if (annule) return;
        const rows = (res.data || []).filter((t) => t.is_demo !== true);
        setListe(rows);
        const ids = rows.map((t) => t.id);
        setSelection(tourDemande && ids.includes(tourDemande) ? [tourDemande] : ids);
      })
      .catch((e) => { if (!annule) { setListe([]); setSelection([]); setErreur(e.response?.data?.error || 'Impossible de charger les tournées de ce jour.'); } })
      .finally(() => { if (!annule) setChargementListe(false); });
    return () => { annule = true; };
  }, [date, tourDemande]);

  // ── Comptes rendus des tournées sélectionnées (mis en cache) ────────────
  useEffect(() => {
    const manquants = selection.filter((id) => !rapports[id] && !demandesRef.current.has(id));
    if (manquants.length === 0) return undefined;
    manquants.forEach((id) => demandesRef.current.add(id));
    setChargementRapports(true);
    Promise.allSettled(manquants.map((id) => api.get(`/tours/${id}/rapport`, { params: { gps: 'rejeu' }, timeout: 60000 })))
      .then((res) => {
        const ajout = {};
        const ko = [];
        res.forEach((r, i) => {
          if (r.status === 'fulfilled') ajout[manquants[i]] = preparerTournee(r.value.data);
          else ko.push(manquants[i]);
        });
        // Les réponses sont gardées même si la sélection a bougé entre-temps :
        // elles ont été demandées une seule fois et resserviront.
        setRapports((prev) => ({ ...prev, ...ajout }));
        setEchecs((prev) => [...new Set([...prev.filter((id) => !ajout[id]), ...ko])]);
        setChargementRapports(false);
      });
  }, [selection, rapports]);

  // Couleur stable par tournée : rang dans la liste du jour, pas dans la sélection.
  const couleurDe = useCallback((id) => {
    const i = liste.findIndex((t) => t.id === id);
    return TOUR_COLORS[(i < 0 ? 0 : i) % TOUR_COLORS.length];
  }, [liste]);

  const tournees = useMemo(
    () => selection.map((id) => rapports[id]).filter(Boolean),
    [selection, rapports],
  );

  const centre = useMemo(() => {
    const c = tournees.find((tr) => tr.rapport.planned_route?.centre_tri)?.rapport.planned_route.centre_tri;
    return c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude) ? c : null;
  }, [tournees]);

  const debut = useMemo(() => {
    const v = tournees.map((tr) => tr.debut).filter((t) => t !== null);
    return v.length ? Math.min(...v) : null;
  }, [tournees]);
  const fin = useMemo(() => {
    const v = tournees.map((tr) => tr.fin).filter((t) => t !== null);
    return v.length ? Math.max(...v) : null;
  }, [tournees]);

  // Curseur ramené dans les bornes quand la sélection change.
  useEffect(() => {
    if (debut === null || fin === null) return;
    setT((prev) => (prev === null || prev < debut || prev > fin ? debut : prev));
  }, [debut, fin]);

  // ── Lecture accélérée ───────────────────────────────────────────────────
  useEffect(() => {
    if (!lecture || fin === null) return undefined;
    const PAS_MS = 200;
    const id = setInterval(() => {
      setT((prev) => Math.min(fin, (prev ?? debut) + PAS_MS * vitesse));
    }, PAS_MS);
    return () => clearInterval(id);
  }, [lecture, vitesse, debut, fin]);

  // Arrivé au bout de la journée, la lecture s'arrête d'elle-même.
  useEffect(() => {
    if (lecture && T !== null && fin !== null && T >= fin) setLecture(false);
  }, [lecture, T, fin]);

  const evenements = useMemo(
    () => journal(tournees, { incident: libelleTypeIncident }),
    [tournees],
  );
  const dernierPasse = useMemo(() => {
    if (T === null) return -1;
    let idx = -1;
    evenements.forEach((e, i) => { if (e.t <= T) idx = i; });
    return idx;
  }, [evenements, T]);

  // Le journal suit le curseur.
  useEffect(() => {
    if (dernierPasse < 0 || !journalRef.current) return;
    const el = journalRef.current.querySelector(`[data-ev="${dernierPasse}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [dernierPasse]);

  const etats = useMemo(() => {
    if (T === null) return {};
    const out = {};
    tournees.forEach((tr) => { out[tr.id] = { ...etatA(tr, T), position: positionA(tr, T, centre) }; });
    return out;
  }, [tournees, T, centre]);

  const kpis = useMemo(() => {
    const liste_ = Object.values(etats);
    const total = liste_.reduce((s, e) => s + e.total, 0);
    const collectes = liste_.reduce((s, e) => s + e.collectes, 0);
    return {
      enCollecte: liste_.filter((e) => e.phase === 'en_cours').length,
      collectes,
      total,
      avancement: total > 0 ? Math.round((collectes / total) * 100) : 0,
      poids: liste_.reduce((s, e) => s + e.poidsKg, 0),
    };
  }, [etats]);

  const bornesCarte = useMemo(() => {
    const pts = [];
    tournees.forEach((tr) => {
      tr.gps.forEach((p) => pts.push([p.lat, p.lng]));
      tr.points.forEach((p) => { if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) pts.push([p.latitude, p.longitude]); });
    });
    if (centre) pts.push([centre.latitude, centre.longitude]);
    return pts;
    // Recadrer seulement quand la SÉLECTION change, pas à chaque image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournees.map((tr) => tr.id).join(','), centre]);

  const changerDate = (d) => {
    setDate(d);
    const p = new URLSearchParams(searchParams);
    p.set('date', d);
    p.delete('tour');
    setSearchParams(p, { replace: true });
  };

  const basculer = (id) => {
    setSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const avancer = (deltaMs) => {
    if (T === null || debut === null) return;
    setT(Math.min(fin, Math.max(debut, T + deltaMs)));
  };

  const aujourdHui = jourParis();

  return (
    <Layout>
      <div className="space-y-4">
        <PageHeader
          title="Revoir une collecte"
          subtitle="Rejouez une journée de collecte terminée, comme en direct"
          icon={HistoryIcon}
        />

        {/* ── Choix du jour et des tournées ───────────────────────────── */}
        <div className="card-modern p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => changerDate(decalerJour(date, -1))} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200" aria-label="Jour précédent">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="date"
              value={date}
              max={aujourdHui}
              onChange={(e) => e.target.value && changerDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
            />
            <button type="button" onClick={() => changerDate(decalerJour(date, 1))} disabled={date >= aujourdHui} className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40" aria-label="Jour suivant">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => changerDate(decalerJour(aujourdHui, -1))} className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">Hier</button>
            <button type="button" onClick={() => changerDate(aujourdHui)} className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">Aujourd'hui</button>
            <span className="text-sm text-slate-600 ml-2">
              {new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>

          {chargementListe ? (
            <LoadingSpinner message="Chargement des tournées…" />
          ) : erreur ? (
            <p className="text-sm text-red-600">{erreur}</p>
          ) : liste.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucune tournée terminée ce jour-là. Les tournées encore en cours se suivent dans{' '}
              <Link to="/collections-live" className="text-teal-700 underline">Collecte en direct</Link>.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {liste.map((t) => {
                const actif = selection.includes(t.id);
                const couleur = couleurDe(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => basculer(t.id)}
                    aria-pressed={actif}
                    className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition ${actif ? 'bg-white border-slate-300 shadow-sm' : 'bg-slate-50 border-slate-200 opacity-60'}`}
                  >
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: couleur }} />
                    <span className="font-semibold text-slate-700">{t.registration || t.vehicle_name || `Tournée #${t.id}`}</span>
                    <span className="text-slate-500">{t.driver_name || 'sans chauffeur'}</span>
                    <span className="text-slate-400">#{t.id}</span>
                  </button>
                );
              })}
            </div>
          )}
          {echecs.length > 0 && (
            <p className="text-xs text-amber-700">
              Compte rendu indisponible pour : {echecs.map((id) => `#${id}`).join(', ')}.
            </p>
          )}
        </div>

        {selection.length > 0 && tournees.length === 0 && chargementRapports && (
          <LoadingSpinner size="lg" message="Chargement de la journée…" />
        )}

        {tournees.length > 0 && T !== null && (
          <>
            {/* ── Indicateurs À L'INSTANT DU CURSEUR ────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiTile label={`Véhicules en collecte à ${fmtHeure(T)}`} value={kpis.enCollecte} icon={Truck} color="teal" />
              <KpiTile label="Points collectés" value={`${kpis.collectes} / ${kpis.total}`} icon={MapPin} color="emerald" />
              <KpiTile
                label="Avancement de la journée"
                value={`${kpis.avancement}%`}
                icon={Gauge}
                color={kpis.avancement >= 80 ? 'emerald' : kpis.avancement >= 50 ? 'amber' : 'slate'}
                footer={<ProgressBar pct={kpis.avancement} />}
              />
              <KpiTile label="Poids pesé" value={`${kpis.poids.toLocaleString('fr-FR')} kg`} icon={Scale} color="slate" />
            </div>

            {/* ── Commandes de lecture ──────────────────────────────────── */}
            <div className="card-modern p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { setT(debut); setLecture(false); }} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200" aria-label="Revenir au début">
                  <SkipBack className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => avancer(-15 * 60000)} className="text-xs px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200">−15 min</button>
                <button
                  type="button"
                  onClick={() => { if (T >= fin) setT(debut); setLecture((v) => !v); }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold"
                >
                  {lecture ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {lecture ? 'Pause' : 'Lecture'}
                </button>
                <button type="button" onClick={() => avancer(15 * 60000)} className="text-xs px-2 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200">+15 min</button>
                <button type="button" onClick={() => { setT(fin); setLecture(false); }} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200" aria-label="Aller à la fin">
                  <SkipForward className="w-4 h-4" />
                </button>
                <label className="text-xs text-slate-600 flex items-center gap-1 ml-2">
                  Vitesse
                  <select value={vitesse} onChange={(e) => setVitesse(Number(e.target.value))} className="border border-slate-300 rounded-md px-1.5 py-1 text-xs">
                    {VITESSES.map((v) => <option key={v} value={v}>×{v}</option>)}
                  </select>
                </label>
                <span className="ml-auto text-2xl font-extrabold text-slate-800 tabular-nums">{fmtHeure(T, true)}</span>
                {chargementRapports && <span className="text-xs text-slate-400">chargement…</span>}
              </div>
              <input
                type="range"
                min={debut}
                max={fin}
                step={1000}
                value={T}
                onChange={(e) => { setT(Number(e.target.value)); }}
                className="w-full accent-teal-600"
                aria-label="Heure du rejeu"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>{fmtHeure(debut)}</span>
                <span>Durée de la journée : {fmtDuree((fin - debut) / 60000)}</span>
                <span>{fmtHeure(fin)}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              {/* ── Carte ─────────────────────────────────────────────── */}
              <div className="card-modern overflow-hidden xl:col-span-2" style={{ height: '60vh' }}>
                <MapContainer center={centre ? [centre.latitude, centre.longitude] : [49.4231, 1.0993]} zoom={11} style={{ height: '100%', width: '100%' }}>
                  <MapSizeFix />
                  <FondCarte />
                  <Cadrage bornes={bornesCarte} />

                  {centre && (
                    <Marker position={[centre.latitude, centre.longitude]} icon={centreTriIcon()} zIndexOffset={-100}>
                      <Popup><p className="text-xs font-bold">🏭 {centre.nom || 'Centre de tri'}</p></Popup>
                    </Marker>
                  )}

                  {tournees.map((tr) => {
                    const couleur = couleurDe(tr.id);
                    const etat = etats[tr.id];
                    const pos = etat?.position;
                    const trajetComplet = tr.gps.map((p) => [p.lat, p.lng]);
                    return (
                      <FragmentTournee key={tr.id}>
                        {/* Trajet de la journée entière, en fond, puis la part déjà parcourue. */}
                        {trajetComplet.length > 1 && (
                          <Polyline positions={trajetComplet} pathOptions={{ color: couleur, weight: 3, opacity: 0.18 }} />
                        )}
                        {pos && pos.trace.length > 1 && (
                          <Polyline
                            positions={pos.trace}
                            pathOptions={{ color: couleur, weight: 4, opacity: 0.9, dashArray: pos.source === 'gps' ? null : '6 8' }}
                          />
                        )}

                        {tr.points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)).map((p) => {
                          if (p.kind === 'arret_technique') return null;
                          const statut = statutPointA(tr, p, T);
                          const rempli = COULEUR_POINT[statut];
                          return (
                            <CircleMarker
                              key={`${p.kind}-${p.id}`}
                              center={[p.latitude, p.longitude]}
                              radius={7}
                              pathOptions={{ color: couleur, weight: 2, fillColor: rempli || '#FFFFFF', fillOpacity: rempli ? 0.95 : 0.9 }}
                            >
                              <Popup>
                                <div className="text-xs space-y-0.5">
                                  <p className="font-bold">{p.rank}. {p.name}</p>
                                  {p.address && <p className="text-slate-500">{p.address}{p.commune ? `, ${p.commune}` : ''}</p>}
                                  <p>{libelleStatutPoint(statut)}{p.t !== null && T >= p.t ? ` à ${fmtHeure(p.t)}` : ''}</p>
                                  {p.planned_passage_time && <p className="text-slate-500">Prévu à {fmtHeure(new Date(p.planned_passage_time).getTime())}</p>}
                                  {statut === 'skipped' && p.skip_reason_label && <p className="text-amber-700">{p.skip_reason_label}</p>}
                                  {p.fill_effective_percent !== null && statut === 'collected' && <p>Remplissage déclaré : {p.fill_effective_percent} %</p>}
                                  {p.nb_sacs !== null && statut === 'collected' && <p>{p.nb_sacs} sac{p.nb_sacs > 1 ? 's' : ''}</p>}
                                </div>
                              </Popup>
                            </CircleMarker>
                          );
                        })}

                        {pos && etat.phase !== 'pas_partie' && (
                          <Marker position={[pos.lat, pos.lng]} icon={truckIcon(couleur, etat.phase === 'terminee')} zIndexOffset={1000}>
                            <Popup>
                              <div className="text-xs space-y-0.5">
                                <p className="font-bold">🚛 {tr.tour.vehicle?.registration || tr.tour.vehicle?.name || `#${tr.id}`}</p>
                                {tr.tour.driver?.name && <p>{tr.tour.driver.name}</p>}
                                <p>{PHASES[etat.phase].label} — {etat.collectes}/{etat.total} points</p>
                                {pos.speed !== null && pos.speed !== undefined && <p>{Math.round(pos.speed)} km/h</p>}
                                {pos.source !== 'gps' && <p className="text-amber-700">Position reconstituée (pas de trace GPS)</p>}
                              </div>
                            </Popup>
                          </Marker>
                        )}
                      </FragmentTournee>
                    );
                  })}
                </MapContainer>
              </div>

              {/* ── Journal de la journée ─────────────────────────────── */}
              <div className="card-modern p-3 flex flex-col" style={{ height: '60vh' }}>
                <h2 className="text-sm font-bold text-slate-700 mb-2">Journal de la journée</h2>
                <p className="text-xs text-slate-400 mb-2">Cliquez un événement pour y placer le curseur.</p>
                <div ref={journalRef} className="overflow-y-auto flex-1 space-y-1 pr-1">
                  {evenements.length === 0 && <p className="text-xs text-slate-500">Aucun événement horodaté.</p>}
                  {evenements.map((e, i) => {
                    const passe = e.t <= T;
                    const courant = i === dernierPasse;
                    return (
                      <button
                        key={`${e.tourId}-${e.type}-${e.t}-${i}`}
                        data-ev={i}
                        type="button"
                        onClick={() => { setT(e.t); setLecture(false); }}
                        className={`w-full text-left flex gap-2 items-start text-xs rounded-md px-2 py-1.5 border-l-4 transition ${courant ? 'bg-teal-50' : passe ? 'bg-white' : 'bg-slate-50 opacity-50'} hover:bg-slate-100`}
                        style={{ borderLeftColor: couleurDe(e.tourId) }}
                      >
                        <span className="tabular-nums text-slate-500 shrink-0">{fmtHeure(e.t)}</span>
                        <span className="shrink-0">{ICONES_EVENEMENT[e.type] || '•'}</span>
                        <span className="text-slate-700">{e.texte}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ── Tournées à l'instant T ───────────────────────────────── */}
            <div className="card-modern overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2">Tournée</th>
                    <th className="text-left px-3 py-2">Chauffeur</th>
                    <th className="text-left px-3 py-2">État à {fmtHeure(T)}</th>
                    <th className="text-left px-3 py-2 w-48">Avancement</th>
                    <th className="text-right px-3 py-2">Poids pesé</th>
                    <th className="text-right px-3 py-2">Incidents</th>
                    <th className="text-left px-3 py-2">Horaires réels</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {tournees.map((tr) => {
                    const e = etats[tr.id];
                    if (!e) return null;
                    const couleur = couleurDe(tr.id);
                    const sansGps = tr.gps.length === 0;
                    return (
                      <tr key={tr.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: couleur }} />
                            <span className="font-semibold">{tr.tour.vehicle?.registration || tr.tour.vehicle?.name || '—'}</span>
                            <span className="text-xs text-slate-400">#{tr.id}</span>
                          </div>
                          {sansGps && (
                            <p className="text-[11px] text-amber-700 flex items-center gap-1 mt-0.5">
                              <AlertTriangle className="w-3 h-3" /> Aucune trace GPS : trajet reconstitué d'après les points
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{tr.tour.driver?.name || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PHASES[e.phase].classe}`}>{PHASES[e.phase].label}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-1"><ProgressBar pct={e.avancementPct} color={couleur} /></div>
                            <span className="text-xs text-slate-600 tabular-nums">{e.collectes}/{e.total}</span>
                          </div>
                          {e.nonCollectes > 0 && <p className="text-[11px] text-amber-700">{e.nonCollectes} non collecté{e.nonCollectes > 1 ? 's' : ''}</p>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.poidsKg.toLocaleString('fr-FR')} kg</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.incidents}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {fmtHeure(tr.departAt)} → {fmtHeure(tr.finAt)}
                        </td>
                        <td className="px-3 py-2">
                          <Link to={`/tours?tour=${tr.id}`} className="text-xs text-teal-700 hover:underline flex items-center gap-1" title="Ouvrir la fiche de tournée et son compte rendu">
                            <FileText className="w-3.5 h-3.5" /> Fiche
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-400">
              Positions rejouées depuis les relevés GPS enregistrés (conservés 90 jours) ; entre deux relevés
              rapprochés, la position est interpolée. Consultation journalisée, comme le compte rendu de tournée.
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}

function FragmentTournee({ children }) {
  return <>{children}</>;
}

function KpiTile({ label, value, icon: Icon, color, footer }) {
  const styles = {
    teal: { bg: 'bg-teal-50', text: 'text-teal-700', icon: 'text-teal-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-600' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-600' },
    slate: { bg: 'bg-slate-50', text: 'text-slate-700', icon: 'text-slate-500' },
  }[color] || { bg: 'bg-slate-50', text: 'text-slate-700', icon: 'text-slate-500' };
  return (
    <div className={`card-modern p-4 ${styles.bg}`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <Icon className={`w-5 h-5 ${styles.icon}`} />
      </div>
      <p className={`text-3xl font-extrabold tracking-tight ${styles.text}`}>{value}</p>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

function ProgressBar({ pct, color = '#0D9488' }) {
  const safe = Math.min(100, Math.max(0, pct || 0));
  return (
    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
      <div className="h-full" style={{ width: `${safe}%`, backgroundColor: color }} />
    </div>
  );
}
