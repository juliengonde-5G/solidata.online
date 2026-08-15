import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Download, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, useToast } from '../../components';
import { compareByName } from '../../utils/names';
import {
  apiErr, blobErr, fmtHeure, fmtHeureParis, employeeName, currentPeriode,
  STATUT_FEUILLE_LABELS, SENS_LABELS, StatutFeuilleChip,
} from './badgeuseShared';

// Normalise `detail` (JSONB, structure par jour) en tableau exploitable, que
// le backend renvoie un objet indexé par date ou déjà un tableau.
function normalizeDetail(detail) {
  if (!detail) return [];
  if (Array.isArray(detail)) return detail;
  if (typeof detail === 'object') {
    return Object.entries(detail).map(([date, v]) => ({ date, ...(typeof v === 'object' ? v : { valeur: v }) }));
  }
  return [];
}

function DetailJour({ jour }) {
  const evenements = Array.isArray(jour.evenements) ? jour.evenements : (Array.isArray(jour.pointages) ? jour.pointages : []);
  const anomalies = Array.isArray(jour.anomalies) ? jour.anomalies : [];
  return (
    <div className="flex flex-wrap items-start gap-4 py-1.5 text-sm">
      <span className="w-24 flex-shrink-0 font-medium text-slate-700">{jour.date}</span>
      <span className="flex-1 min-w-[160px] text-slate-600">
        {evenements.length === 0 ? <span className="text-slate-300">aucun événement</span> : evenements.map((ev, i) => (
          <span key={i} className="inline-block mr-2">
            {(ev.heure || ev.heure_paris) ?? (ev.horodatage_utc ? fmtHeureParis(ev.horodatage_utc) : '?')}
            {' '}<span className={ev.sens === 'sortie' ? 'text-orange-600' : 'text-emerald-600'}>{SENS_LABELS[ev.sens] || ev.sens || ''}</span>
          </span>
        ))}
      </span>
      <span className="w-20 flex-shrink-0 text-right text-slate-700">{jour.heures != null ? fmtHeure(jour.heures) : '—'}</span>
      <span className="flex-1 min-w-[140px]">
        {anomalies.length > 0 && (
          <span className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
            {anomalies.map((a) => (typeof a === 'string' ? a : a.type || a.label)).join(', ')}
          </span>
        )}
      </span>
    </div>
  );
}

function FeuilleRow({ row, periode, canValidateEncadrant, canValidateRh, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(row.detail || null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [validating, setValidating] = useState(null); // 'encadrant' | 'rh'

  const toggle = async () => {
    setOpen((o) => !o);
    if (!open && detail == null) {
      setLoadingDetail(true);
      try {
        const r = await api.get(`/badgeuse/feuilles-temps/${row.employee_id}?periode=${periode}`);
        setDetail(r.data?.detail ?? row.detail ?? []);
      } catch {
        setDetail([]);
      } finally { setLoadingDetail(false); }
    }
  };

  const valider = async (niveau) => {
    setValidating(niveau);
    try {
      await api.post(`/badgeuse/feuilles-temps/${row.employee_id}/valider`, { periode, niveau });
      toast.success(niveau === 'rh' ? 'Feuille validée par le RH.' : 'Feuille validée par l\'encadrant.');
      onChanged();
    } catch (err) {
      toast.error(apiErr(err, 'Validation impossible.'));
    } finally { setValidating(null); }
  };

  const jours = useMemo(() => normalizeDetail(detail), [detail]);

  return (
    <>
      <tr className="border-b border-slate-100">
        <td className="py-2 px-2">
          <button onClick={toggle} className="inline-flex items-center gap-1.5 text-slate-700 font-medium hover:text-teal-700">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {employeeName(row)}
          </button>
        </td>
        <td className="py-2 px-2 text-right text-slate-600">{row.heures_theoriques != null ? fmtHeure(row.heures_theoriques) : '—'}</td>
        <td className="py-2 px-2 text-right font-medium text-slate-800">{fmtHeure(row.heures_pointees)}</td>
        <td className="py-2 px-2 text-right text-slate-600">{row.heures_validees != null ? fmtHeure(row.heures_validees) : '—'}</td>
        <td className="py-2 px-2 text-center"><StatutFeuilleChip statut={row.statut} /></td>
        <td className="py-2 px-2 text-right whitespace-nowrap">
          {canValidateEncadrant && (row.statut === 'brouillon' || !row.statut) && (
            <button onClick={() => valider('encadrant')} disabled={validating != null}
              className="text-xs font-medium text-amber-700 hover:text-amber-900 disabled:opacity-50 inline-flex items-center gap-1 mr-3">
              <CheckCircle2 className="w-3.5 h-3.5" /> {validating === 'encadrant' ? 'Validation…' : 'Valider (encadrant)'}
            </button>
          )}
          {canValidateRh && row.statut === 'validee_encadrant' && (
            <button onClick={() => valider('rh')} disabled={validating != null}
              className="text-xs font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-50 inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> {validating === 'rh' ? 'Validation…' : 'Valider (RH)'}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={6} className="px-4 py-2">
            {loadingDetail ? <LoadingSpinner size="sm" /> : jours.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">Aucun détail journalier disponible.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {jours.map((j, i) => <DetailJour key={j.date || i} jour={j} />)}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Onglet Feuilles de temps ──────────────────────────────────────────────────
export default function FeuillesTemps({ canValidateEncadrant, canValidateRh, canExport }) {
  const [periode, setPeriode] = useState(currentPeriode());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [heuresFormat, setHeuresFormat] = useState('decimal');
  const [exporting, setExporting] = useState(null); // 'paie' | 'iae' | null
  const [exportWarning, setExportWarning] = useState(null); // { kind, message }

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/badgeuse/feuilles-temps?periode=${periode}`)
      .then((r) => {
        const d = r.data;
        const list = Array.isArray(d) ? d : (d.feuilles || d.rows || d.items || []);
        setRows([...list].sort(compareByName));
        setError(null);
      })
      .catch((err) => setError(apiErr(err, 'Chargement des feuilles de temps impossible.')))
      .finally(() => setLoading(false));
  }, [periode]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setExportWarning(null); }, [periode]);

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const doExport = async (kind, force = false) => {
    setExporting(kind); setExportWarning(null);
    try {
      const url = kind === 'paie'
        ? `/badgeuse/exports/paie?periode=${periode}&heures=${heuresFormat}${force ? '&force=1' : ''}`
        : `/badgeuse/exports/iae?periode=${periode}${force ? '&force=1' : ''}`;
      const res = await api.get(url, { responseType: 'blob' });
      download(res.data, `badgeuse_${kind}_${periode}${force ? '_partiel' : ''}.csv`);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409) {
        const msg = await blobErr(err, "Certaines feuilles de temps de cette période ne sont pas encore validées par le RH.");
        setExportWarning({ kind, message: msg });
      } else {
        setExportWarning({ kind, message: await blobErr(err, `Échec de l'export ${kind === 'paie' ? 'paie' : 'heures IAE'}.`) });
      }
    } finally { setExporting(null); }
  };

  if (error) return <ErrorState variant="card" title="Feuilles de temps indisponibles" message={error} onRetry={load} />;

  return (
    <div className="space-y-5">
      {/* Sélecteur de période + exports */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="ft-periode" className="block text-xs font-medium text-slate-600 mb-1">Période</label>
          <input id="ft-periode" type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} className="input-modern py-2 text-sm" />
        </div>
        {canExport && (
          <>
            <div>
              <label htmlFor="ft-heures" className="block text-xs font-medium text-slate-600 mb-1">Format des heures (export paie)</label>
              <select id="ft-heures" value={heuresFormat} onChange={(e) => setHeuresFormat(e.target.value)} className="input-modern py-2 text-sm">
                <option value="decimal">Décimal (7,70)</option>
                <option value="hms">Heures:minutes (07:42)</option>
              </select>
            </div>
            <div className="flex-1" />
            <button onClick={() => doExport('paie')} disabled={exporting != null}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <Download className="w-4 h-4" /> {exporting === 'paie' ? 'Export…' : 'Export paie (CSV)'}
            </button>
            <button onClick={() => doExport('iae')} disabled={exporting != null}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <FileSpreadsheet className="w-4 h-4" /> {exporting === 'iae' ? 'Export…' : 'Export heures IAE (CSV)'}
            </button>
          </>
        )}
      </div>

      {exportWarning && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
          <span>{exportWarning.message}</span>
          <button onClick={() => doExport(exportWarning.kind, true)} disabled={exporting != null}
            className="text-xs font-medium bg-white border border-amber-300 rounded-lg px-2.5 py-1 hover:bg-amber-100 disabled:opacity-50">
            Exporter quand même les feuilles validées
          </button>
        </div>
      )}

      {/* Tableau */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 mb-3">Feuilles de temps — {periode}</h3>
        {loading ? (
          <LoadingSpinner size="lg" message="Chargement des feuilles de temps…" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">Aucune feuille de temps pour cette période.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-2">Salarié</th>
                  <th className="text-right py-2 px-2">Théoriques</th>
                  <th className="text-right py-2 px-2">Pointées</th>
                  <th className="text-right py-2 px-2">Validées</th>
                  <th className="text-center py-2 px-2">Statut</th>
                  <th className="text-right py-2 px-2">Circuit de validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <FeuilleRow key={row.employee_id} row={row} periode={periode}
                    canValidateEncadrant={canValidateEncadrant} canValidateRh={canValidateRh}
                    onChanged={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          Statuts : {Object.entries(STATUT_FEUILLE_LABELS).map(([k, l]) => l).join(' → ')}. Une feuille dévalidée relève d'un ADMIN (journalisé).
        </p>
      </div>
    </div>
  );
}
