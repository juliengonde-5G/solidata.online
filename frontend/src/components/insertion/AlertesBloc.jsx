import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

/**
 * Points d'attention de la fiche salarié (GET /insertion/alertes/:employeeId).
 * Contrat : { employee_id, generated_at, total, alertes:[{type,niveau,message,...}],
 *             acquittees:[{...alerte, acked_until}], alertes_scheduler:[] }.
 *
 * REC-UX-08 : 3 niveaux visuels seulement (rouge = réglementaire/contractuel,
 * ambre = process, gris = information), plafond d'affichage + « voir tout ».
 * Acquittement « Vu — me le rappeler dans 7 j » JOURNALISÉ CÔTÉ SERVEUR
 * (POST /insertion/alertes/:employeeId/ack, table insertion_alert_acks —
 * phase D écart 1c) : partagé entre les CIP, fini le localStorage navigateur.
 */

const NIVEAU_STYLES = {
  critique: 'bg-red-50 border-red-200 text-red-800',
  attention: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-slate-50 border-slate-200 text-slate-600',
};
const NIVEAU_DOT = { critique: 'bg-red-500', attention: 'bg-amber-500', info: 'bg-slate-400' };
const MAX_VISIBLE = 4;
const SNOOZE_DAYS = 7;

export default function AlertesBloc({ employeeId, compact = false, onCountChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [acking, setAcking] = useState(null); // type en cours d'acquittement

  const load = useCallback(() => {
    let alive = true;
    api.get(`/insertion/alertes/${employeeId}`)
      .then((r) => { if (alive) { setData(r.data); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); });
    return () => { alive = false; };
  }, [employeeId]);

  useEffect(() => load(), [load]);

  const active = data?.alertes || [];
  const snoozed = (data?.acquittees || []).length;

  useEffect(() => {
    if (onCountChange && data) onCountChange(active.length, active.filter((a) => a.niveau === 'critique').length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const snooze = async (a) => {
    setAcking(a.type);
    try {
      const jusquAu = new Date(Date.now() + SNOOZE_DAYS * 86400000).toISOString();
      await api.post(`/insertion/alertes/${employeeId}/ack`, { type: a.type, jusqu_au: jusquAu });
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setAcking(null);
    }
  };

  if (error) return <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">Points d'attention indisponibles : {error}</div>;
  if (!data) return null;

  if (active.length === 0) {
    if (compact) return null;
    return (
      <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-green-500" /> Aucun point d'attention sur ce parcours.
        {snoozed > 0 && <span className="text-gray-400">({snoozed} type(s) en veille)</span>}
      </div>
    );
  }

  // Rouge d'abord, puis ambre, puis le reste.
  const order = { critique: 0, attention: 1 };
  const sorted = [...active].sort((a, b) => (order[a.niveau] ?? 2) - (order[b.niveau] ?? 2));
  const visible = showAll ? sorted : sorted.slice(0, MAX_VISIBLE);
  const nbCritiques = sorted.filter((a) => a.niveau === 'critique').length;

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${nbCritiques ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${nbCritiques ? 'bg-red-500' : 'bg-amber-500'}`} />
        {active.length} point{active.length > 1 ? 's' : ''} d'attention
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Points d'attention ({active.length})
        </h4>
        {snoozed > 0 && <span className="text-[11px] text-gray-400">{snoozed} type(s) en veille</span>}
      </div>
      {visible.map((a, i) => (
        <div key={`${a.type}:${a.milestone_id || a.action_id || i}`} className={`flex items-start gap-2 text-xs border rounded-lg p-2 ${NIVEAU_STYLES[a.niveau] || NIVEAU_STYLES.info}`}>
          <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${NIVEAU_DOT[a.niveau] || NIVEAU_DOT.info}`} />
          <span className="flex-1">{a.message}</span>
          <button type="button" onClick={() => snooze(a)} disabled={acking === a.type}
            title={`Vu — mettre en veille ce type d'alerte ${SNOOZE_DAYS} jours (visible de toute l'équipe)`}
            className="text-[11px] opacity-60 hover:opacity-100 underline flex-shrink-0 disabled:opacity-30">
            {acking === a.type ? '…' : `Vu · ${SNOOZE_DAYS} j`}
          </button>
        </div>
      ))}
      {sorted.length > MAX_VISIBLE && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="text-xs text-teal-700 hover:underline">
          {showAll ? 'Réduire' : `Voir tout (${sorted.length})`}
        </button>
      )}
    </div>
  );
}
