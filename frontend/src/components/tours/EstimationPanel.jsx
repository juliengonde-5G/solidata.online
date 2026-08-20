import { ArrowRight } from 'lucide-react';
import { ErrorState } from '..';

/**
 * EstimationPanel — restitution visuelle de l'objet `estimation` renvoyé par
 * POST /api/tours/estimate (et embarqué dans les réponses de création de
 * tournée). Affiche la jauge temps de travail vs budget (6h, pause déjeuner
 * exclue), les indicateurs clés et une chronologie dépliable.
 *
 * Props :
 *  - estimation : objet `estimation` du contrat backend (ou null)
 *  - loading    : boolean
 *  - error      : string | null
 *  - compact    : boolean — variante tuiles condensées (cartes proposition IA,
 *                 tableaux de bord)
 */

function fmtDurMin(min) {
  if (min == null || Number.isNaN(min)) return '—';
  const v = Math.round(min);
  if (v < 60) return `${v} min`;
  const h = Math.floor(v / 60);
  const m = v % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h00`;
}

// Additionne des minutes à une heure 'HH:MM' renvoyée par le backend.
function addMinutesToHHMM(hhmm, minutesToAdd) {
  if (!hhmm || minutesToAdd == null || Number.isNaN(minutesToAdd)) return '—';
  const parts = String(hhmm).split(':').map(Number);
  if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return '—';
  const total = parts[0] * 60 + parts[1] + Math.round(minutesToAdd);
  const normalized = ((total % 1440) + 1440) % 1440;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

const TIMELINE_META = {
  depart: { label: 'Départ du centre de tri', color: 'bg-slate-400' },
  point: { label: null, color: 'bg-teal-500' },
  retour_vidage: { label: 'Retour vidage (centre)', color: 'bg-blue-400' },
  pause_dejeuner: { label: 'Pause déjeuner (centre)', color: 'bg-amber-400' },
  retour_final: { label: 'Retour final (centre)', color: 'bg-slate-600' },
};

function TimelineRow({ step, heureDepart }) {
  const meta = TIMELINE_META[step.type] || { label: step.type, color: 'bg-slate-300' };
  const label = step.type === 'point'
    ? (step.name || `Point #${step.cav_id || step.association_point_id || ''}`)
    : meta.label;
  const arrivee = addMinutesToHHMM(heureDepart, step.arrivee_min);
  const depart = step.depart_min != null ? addMinutesToHHMM(heureDepart, step.depart_min) : null;
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.color}`} />
      <span className="w-11 flex-shrink-0 font-mono text-slate-500">{arrivee}</span>
      <span className="flex-1 min-w-0 truncate text-slate-700">{label}</span>
      {depart && depart !== arrivee && (
        <span className="flex-shrink-0 text-[10px] text-slate-400">→ {depart}</span>
      )}
      {step.poids_cumule_kg != null && (
        <span className="flex-shrink-0 text-[10px] text-slate-400 tabular-nums">{Math.round(step.poids_cumule_kg)} kg</span>
      )}
    </div>
  );
}

function Tile({ label, value }) {
  return (
    <div className="bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

export default function EstimationPanel({ estimation, loading, error, compact = false }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-center gap-2 text-sm text-slate-500">
        <span className="animate-spin rounded-full h-4 w-4 border-2 border-teal-500 border-t-transparent flex-shrink-0" />
        Calcul de l'estimation…
      </div>
    );
  }
  if (error) {
    return <ErrorState variant="card" title="Estimation indisponible" message={error} />;
  }
  if (!estimation) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-400 text-center">
        Sélectionnez les éléments nécessaires pour calculer l'estimation.
      </div>
    );
  }

  const budget = estimation.budget_travail_min || 0;
  const travail = estimation.duree_travail_min || 0;
  const pct = budget > 0 ? Math.round((travail / budget) * 100) : 0;
  const barColor = pct <= 85 ? 'bg-emerald-500' : pct <= 100 ? 'bg-amber-500' : 'bg-red-500';

  if (compact) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Estimation</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${estimation.faisable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {estimation.faisable ? 'Réalisable' : `+${fmtDurMin(estimation.depassement_min)}`}
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mb-2">
          <div className={`h-1.5 rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-600">
          <span>Poids : <strong className="text-slate-800">{Math.round(estimation.poids_estime_kg || 0)} kg</strong></span>
          <span>Véhicule : <strong className="text-slate-800">{Math.round(estimation.taux_remplissage_vehicule_pct || 0)}%</strong></span>
          <span>Retours vidage : <strong className="text-slate-800">{estimation.nb_retours_vidage ?? 0}</strong></span>
          <span>Pause : <strong className="text-slate-800">{estimation.pause_dejeuner_incluse ? 'incluse' : 'non requise'}</strong></span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Jauge temps de travail */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Temps de travail (pause déjeuner exclue)</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${estimation.faisable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {estimation.faisable ? 'Réalisable' : `Dépassement de ${fmtDurMin(estimation.depassement_min)}`}
          </span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
          <div className={`h-3 rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="flex justify-between text-xs text-slate-500 mt-1.5">
          <span>Travail effectif : <strong className="text-slate-700">{fmtDurMin(travail)}</strong></span>
          <span>Budget : <strong className="text-slate-700">{fmtDurMin(budget)}</strong></span>
        </div>
      </div>

      {/* Indicateurs clés */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-100 border-b border-slate-100">
        <Tile label="Pause déjeuner" value={estimation.pause_dejeuner_incluse ? `${fmtDurMin(estimation.pause_dejeuner_min)} (au centre)` : 'Non nécessaire'} />
        <Tile label="Retours de vidage" value={estimation.nb_retours_vidage ?? 0} />
        <Tile label="Points de collecte" value={estimation.nb_points ?? 0} />
        <Tile label="Poids estimé" value={`${Math.round(estimation.poids_estime_kg || 0)} kg`} />
        <Tile label="Remplissage véhicule" value={`${Math.round(estimation.taux_remplissage_vehicule_pct || 0)}%${estimation.capacite_vehicule_kg ? ` (/ ${Math.round(estimation.capacite_vehicule_kg)} kg)` : ''}`} />
        <Tile label="Distance" value={`${estimation.distance_km != null ? Number(estimation.distance_km).toFixed(1) : '—'} km`} />
      </div>

      {/* Départ / fin */}
      <div className="px-4 py-3 flex items-center justify-center gap-3 text-sm border-b border-slate-100">
        <span className="text-slate-500">Départ <strong className="text-slate-800">{estimation.heure_depart || '—'}</strong></span>
        <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
        <span className="text-slate-500">Fin estimée <strong className="text-slate-800">{estimation.heure_fin_estimee || '—'}</strong></span>
      </div>

      {/* Avertissements */}
      {estimation.avertissements?.length > 0 && (
        <div className="p-4 border-b border-slate-100">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-1">Avertissements</p>
            <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
              {estimation.avertissements.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Chronologie */}
      {estimation.timeline?.length > 0 && (
        <details className="p-4">
          <summary className="text-xs font-semibold text-teal-700 cursor-pointer hover:text-teal-800 select-none">
            Chronologie détaillée ({estimation.timeline.length} étapes)
          </summary>
          <div className="mt-2 max-h-56 overflow-y-auto border-t border-slate-100 pt-2">
            {estimation.timeline.map((step, i) => (
              <TimelineRow key={i} step={step} heureDepart={estimation.heure_depart} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
