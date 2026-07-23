import { useState, useMemo, useRef, useEffect } from 'react';
import { ENTRETIEN_TYPE_LABELS, entretienLabel, frDate } from './freins';

/**
 * Frise du parcours (REC-UX-05) — rendu horizontal en COULOIRS superposés :
 *   Contrats / Entretiens / Objectifs / PMSMP.
 * - graduations mensuelles, ligne « aujourd'hui », défilement horizontal
 *   (overflow-x + molette) ;
 * - cases à cocher par couloir (objectifs masqués par défaut — REC-UX-05) ;
 * - regroupement automatique des événements trop proches (pastille « ×N »
 *   dépliable) ;
 * - clic sur un élément → onSelect({ type, data }) (la page ouvre le détail) ;
 * - événement d'embauche marqué « recrutement » quand un candidat est lié.
 * La liste chronologique verticale existante RESTE la vue de référence : la
 * frise s'y ajoute, elle ne la remplace pas.
 */

// Couleurs par type d'entretien (vocabulaire de freins.js — pas de « milestone » à l'écran).
export const ENTRETIEN_TYPE_COLORS = {
  diagnostic_accueil: '#0D9488', // teal — démarrage
  bilan_intermediaire: '#3B82F6', // bleu — bilans de suivi
  renouvellement: '#F59E0B', // ambre — décision contractuelle
  bilan_sortie: '#8B5CF6', // violet — sortie
  suivi_post_sortie: '#64748B', // gris — après le parcours
};

const MONTH_PX = 88; // largeur minimale d'un mois (responsive : le conteneur défile)
const LANE_H = 44; // hauteur d'un couloir
const CLUSTER_PX = 18; // distance de regroupement des marqueurs

const dayMs = 86400000;
const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// Objectif en dépassement de butoir : date_butoir passée sans être atteint/abandonné.
const objectifEnRetard = (o, now) => {
  const butoir = toDate(o.date_butoir);
  return !!butoir && butoir < now && !['atteint', 'abandonne'].includes(o.statut);
};

export default function FriseParcours({
  employee = {},
  contracts = [],
  milestones = [],
  objectifs = [],
  pmsmp = [],
  hasCandidate = false,
  hasPcm = false,
  onSelect,
}) {
  const [lanes, setLanes] = useState({ contrats: true, entretiens: true, objectifs: false, pmsmp: true });
  const [openCluster, setOpenCluster] = useState(null); // clé du groupe déplié
  const scrollRef = useRef(null);
  const now = useMemo(() => new Date(), []);

  // ── Domaine temporel : de la 1re date connue − 15 j à la dernière + 30 j ──
  const domain = useMemo(() => {
    const dates = [];
    for (const c of contracts) { dates.push(toDate(c.start_date), toDate(c.end_date)); }
    for (const m of milestones) { dates.push(toDate(m.due_date), toDate(m.completed_date)); }
    for (const o of objectifs) { dates.push(toDate(o.echeance), toDate(o.date_butoir)); }
    for (const p of pmsmp) { dates.push(toDate(p.date_debut), toDate(p.date_fin)); }
    dates.push(toDate(employee.insertion_start_date), toDate(employee.contract_end));
    const valid = dates.filter(Boolean);
    if (valid.length === 0) return null;
    let min = new Date(Math.min(...valid.map((d) => d.getTime())) - 15 * dayMs);
    let max = new Date(Math.max(...valid.map((d) => d.getTime()), now.getTime()) + 30 * dayMs);
    // Bornes au 1er du mois (graduations propres).
    min = new Date(min.getFullYear(), min.getMonth(), 1);
    max = new Date(max.getFullYear(), max.getMonth() + 1, 1);
    return { min, max };
  }, [contracts, milestones, objectifs, pmsmp, employee, now]);

  const months = useMemo(() => {
    if (!domain) return [];
    const out = [];
    const d = new Date(domain.min);
    while (d < domain.max) {
      out.push(new Date(d));
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [domain]);

  const totalWidth = Math.max(months.length * MONTH_PX, 320);
  const dateToX = (v) => {
    const d = toDate(v);
    if (!d || !domain) return 0;
    const span = domain.max - domain.min;
    return span > 0 ? ((d - domain.min) / span) * totalWidth : 0;
  };

  // ── Molette verticale → défilement horizontal (listener non passif) ──
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [domain]);

  // Défilement initial : cadrer sur aujourd'hui.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && domain) {
      const x = dateToX(now);
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.6);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  // ── Contrats : bandes (repli sur les dates de la fiche si la liste manque) ──
  const contratBands = useMemo(() => {
    const rows = (contracts || []).filter((c) => toDate(c.start_date));
    if (rows.length > 0) {
      return [...rows]
        .sort((a, b) => toDate(a.start_date) - toDate(b.start_date))
        .map((c, i) => ({ id: c.id || i, type: c.contract_type || 'Contrat', start: c.start_date, end: c.end_date, renouvellement: i > 0, data: c }));
    }
    if (employee.insertion_start_date) {
      return [{ id: 'fiche', type: 'CDDI', start: employee.insertion_start_date, end: employee.contract_end, renouvellement: false, data: null }];
    }
    return [];
  }, [contracts, employee]);

  // ── Entretiens : marqueurs regroupés quand trop proches (pastille ×N) ──
  const entretienMarks = useMemo(() => {
    const items = (milestones || [])
      .map((m) => ({ m, date: m.completed_date || m.due_date }))
      .filter((it) => toDate(it.date))
      .sort((a, b) => toDate(a.date) - toDate(b.date))
      .map((it) => ({ ...it, x: dateToX(it.date) }));
    const clusters = [];
    for (const it of items) {
      const last = clusters[clusters.length - 1];
      if (last && it.x - last.x <= CLUSTER_PX) { last.items.push(it); }
      else clusters.push({ x: it.x, items: [it] });
    }
    return clusters;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones, domain, totalWidth]);

  const objectifMarks = useMemo(() => (objectifs || [])
    .map((o) => ({ o, date: o.echeance || o.date_butoir || o.created_at }))
    .filter((it) => toDate(it.date))
    .map((it) => ({ ...it, x: dateToX(it.date), retard: objectifEnRetard(it.o, now) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [objectifs, domain, totalWidth]);

  const pmsmpSegs = useMemo(() => (pmsmp || [])
    .filter((p) => toDate(p.date_debut))
    .map((p, i) => ({ id: p.id || i, p, x1: dateToX(p.date_debut), x2: dateToX(p.date_fin || p.date_debut) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pmsmp, domain, totalWidth]);

  if (!domain) {
    return (
      <div className="text-sm text-gray-400 border border-dashed rounded-lg p-4 text-center">
        Aucun événement daté à afficher — la frise se remplira au démarrage du parcours
        (contrat, diagnostic d'accueil, bilans).
      </div>
    );
  }

  const laneDefs = [
    { key: 'contrats', label: 'Contrats' },
    { key: 'entretiens', label: 'Entretiens' },
    { key: 'objectifs', label: 'Objectifs' },
    { key: 'pmsmp', label: 'PMSMP' },
  ];
  const visibleLanes = laneDefs.filter((l) => lanes[l.key]);
  const todayX = dateToX(now);
  const emit = (type, data) => { if (onSelect) onSelect({ type, data }); };

  const embaucheX = employee.insertion_start_date ? dateToX(employee.insertion_start_date) : null;

  return (
    <div className="space-y-2">
      {/* Filtres par couloir */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-gray-600">
        <span className="font-semibold text-gray-500">Couloirs :</span>
        {laneDefs.map((l) => (
          <label key={l.key} className="flex items-center gap-1 cursor-pointer select-none">
            <input type="checkbox" checked={lanes[l.key]}
              onChange={(e) => setLanes((s) => ({ ...s, [l.key]: e.target.checked }))}
              className="rounded border-gray-300" />
            {l.label}
          </label>
        ))}
        <span className="ml-auto text-[11px] text-gray-400 hidden sm:block">Molette = défiler · clic = ouvrir le détail</span>
      </div>

      <div ref={scrollRef} className="overflow-x-auto border rounded-lg bg-white">
        <div className="relative" style={{ width: totalWidth, minWidth: '100%' }}>
          {/* Graduations mensuelles */}
          <div className="relative h-6 border-b bg-gray-50 text-[10px] text-gray-400">
            {months.map((m) => (
              <span key={m.getTime()} className="absolute top-1 border-l border-gray-200 pl-1 whitespace-nowrap"
                style={{ left: dateToX(m), height: '100%' }}>
                {m.toLocaleDateString('fr-FR', { month: 'short', year: m.getMonth() === 0 ? 'numeric' : undefined })}
                {m.getMonth() === 0 ? '' : ''}
              </span>
            ))}
          </div>

          {/* Couloirs */}
          {visibleLanes.map((lane) => (
            <div key={lane.key} className="relative border-b last:border-b-0" style={{ height: LANE_H }}>
              <span className="sticky left-0 z-20 inline-block text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-white/90 px-1.5 py-0.5 rounded-br">
                {lane.label}
              </span>

              {lane.key === 'contrats' && contratBands.map((c) => {
                const x1 = dateToX(c.start);
                const x2 = c.end ? dateToX(c.end) : Math.min(totalWidth, dateToX(now) + 20);
                return (
                  <button key={c.id} type="button" onClick={() => emit('contrat', c)}
                    title={`${c.type} — ${frDate(c.start)} → ${c.end ? frDate(c.end) : 'en cours'}${c.renouvellement ? ' (renouvellement)' : ''}`}
                    className={`absolute top-5 h-4 rounded text-[10px] text-white px-1.5 overflow-hidden whitespace-nowrap text-left ${c.renouvellement ? 'bg-emerald-500/90 border-l-2 border-white' : 'bg-emerald-600'}`}
                    style={{ left: x1, width: Math.max(10, x2 - x1) }}>
                    {c.renouvellement ? '↻ ' : ''}{c.type}
                  </button>
                );
              })}
              {lane.key === 'contrats' && embaucheX != null && (
                <span className="absolute top-4 -translate-x-1/2 text-[12px]" style={{ left: embaucheX }}
                  title={`Embauche — ${frDate(employee.insertion_start_date)}${hasCandidate ? ' · fiche de recrutement liée' : ''}${hasPcm ? ' · PCM ✓' : ''}`}>
                  {hasCandidate ? '🎯' : '▸'}
                </span>
              )}

              {lane.key === 'entretiens' && entretienMarks.map((cluster, ci) => {
                const key = `c${ci}`;
                if (cluster.items.length === 1) {
                  const { m } = cluster.items[0];
                  const color = ENTRETIEN_TYPE_COLORS[m.milestone_type] || '#64748B';
                  const realise = m.status === 'realise';
                  return (
                    <button key={key} type="button" onClick={() => emit('entretien', m)}
                      title={`${entretienLabel(m)} — ${frDate(m.completed_date || m.due_date)} (${realise ? 'réalisé' : 'planifié'})${m.locked_at ? ' 🔒' : ''}`}
                      className="absolute top-3 -translate-x-1/2 flex flex-col items-center group"
                      style={{ left: cluster.x }}>
                      <span className="w-3.5 h-3.5 rounded-full border-2 transition group-hover:scale-125"
                        style={{ borderColor: color, backgroundColor: realise ? color : 'white' }} />
                      {m.locked_at && <span className="text-[8px] leading-none">🔒</span>}
                    </button>
                  );
                }
                return (
                  <span key={key} className="absolute top-3 -translate-x-1/2" style={{ left: cluster.x }}>
                    <button type="button" onClick={() => setOpenCluster(openCluster === key ? null : key)}
                      title={`${cluster.items.length} entretiens rapprochés — cliquer pour déplier`}
                      className="min-w-[24px] h-5 px-1 rounded-full bg-slate-600 text-white text-[10px] font-semibold hover:bg-slate-700">
                      ×{cluster.items.length}
                    </button>
                    {openCluster === key && (
                      <span className="absolute z-30 top-6 left-1/2 -translate-x-1/2 bg-white border rounded-lg shadow-lg p-1.5 w-52 space-y-0.5">
                        {cluster.items.map(({ m }) => (
                          <button key={m.id} type="button" onClick={() => { setOpenCluster(null); emit('entretien', m); }}
                            className="w-full text-left text-[11px] px-1.5 py-1 rounded hover:bg-teal-50 flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ backgroundColor: m.status === 'realise' ? (ENTRETIEN_TYPE_COLORS[m.milestone_type] || '#64748B') : 'white', border: `2px solid ${ENTRETIEN_TYPE_COLORS[m.milestone_type] || '#64748B'}` }} />
                            <span className="truncate">{entretienLabel(m)}</span>
                            <span className="text-gray-400 ml-auto flex-shrink-0">{frDate(m.completed_date || m.due_date)}</span>
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                );
              })}

              {lane.key === 'objectifs' && objectifMarks.map((it) => (
                <button key={it.o.id} type="button" onClick={() => emit('objectif', it.o)}
                  title={`${it.o.titre} — échéance ${frDate(it.date)}${it.retard ? ' · BUTOIR DÉPASSÉ' : ''} (${it.o.statut})`}
                  className="absolute top-3.5 -translate-x-1/2 hover:scale-125 transition"
                  style={{ left: it.x }}>
                  <span className={`block w-2.5 h-2.5 rotate-45 ${it.retard ? 'bg-red-500' : it.o.statut === 'atteint' ? 'bg-green-500' : 'bg-sky-500'}`} />
                </button>
              ))}

              {lane.key === 'pmsmp' && pmsmpSegs.map((s) => (
                <button key={s.id} type="button" onClick={() => emit('pmsmp', s.p)}
                  title={`PMSMP ${s.p.entreprise || ''} — ${frDate(s.p.date_debut)} → ${frDate(s.p.date_fin)}${s.p.jours ? ` (${s.p.jours} j)` : ''}`}
                  className="absolute top-5 h-3.5 rounded border border-orange-400"
                  style={{
                    left: s.x1,
                    width: Math.max(8, s.x2 - s.x1),
                    background: 'repeating-linear-gradient(45deg, #fdba74, #fdba74 3px, #fff7ed 3px, #fff7ed 6px)',
                  }} />
              ))}
            </div>
          ))}

          {/* Ligne « aujourd'hui » */}
          <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10 pointer-events-none" style={{ left: todayX }}>
            <span className="absolute top-0.5 left-1 text-[9px] text-red-500 font-semibold whitespace-nowrap">Aujourd'hui</span>
          </div>
        </div>
      </div>

      {/* Légende */}
      <div className="flex items-center gap-3 flex-wrap text-[10px] text-gray-400">
        {Object.entries(ENTRETIEN_TYPE_COLORS).map(([t, c]) => (
          <span key={t} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: c }} />
            {ENTRETIEN_TYPE_LABELS[t]}
          </span>
        ))}
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full border-2 border-slate-400 bg-white inline-block" /> planifié (creux)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rotate-45 bg-red-500 inline-block" /> butoir dépassé</span>
        <span>×N = éléments regroupés (cliquer)</span>
      </div>
    </div>
  );
}
