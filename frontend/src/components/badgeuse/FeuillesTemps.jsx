import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Download, FileSpreadsheet, ShieldCheck, Printer, Undo2 } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, useToast, ConfirmDialog } from '../../components';
import { compareByName } from '../../utils/names';
import {
  apiErr, blobErr, fmtHeure, fmtHeureParis, employeeName, currentPeriode,
  STATUT_FEUILLE_LABELS, SENS_LABELS, StatutFeuilleChip,
} from './badgeuseShared';

// Relevé individuel imprimable (remise au salarié : sortie, contestation,
// droit d'accès art. 15 — la consultation est journalisée côté serveur).
// Fenêtre d'impression A4, même mécanisme que les autres exports PDF du dépôt.
function printReleve(d) {
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : '—');
  const jours = Array.isArray(d.jours) ? d.jours : normalizeDetail(d.jours);
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>Relevé d'heures — ${esc(d.nom)} — ${esc(d.periode)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; font-size: 12px; }
  header { background: #0D9488; color: #fff; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; }
  header h1 { margin: 0; font-size: 16px; } header p { margin: 2px 0 0; font-size: 11px; opacity: .9; }
  h2 { font-size: 13px; border-bottom: 2px solid #0D9488; padding-bottom: 3px; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; }
  th { background: #f0fdfa; font-size: 11px; text-transform: uppercase; }
  .kpi { display: inline-block; margin-right: 24px; } .kpi b { font-size: 15px; }
  footer { margin-top: 18px; font-size: 10px; color: #6b7280; }
</style></head><body>
<header><h1>SOLIDATA — Relevé d'heures individuel</h1>
<p>${esc(d.nom)}${d.matricule ? ' — matricule ' + esc(d.matricule) : ''} · Période ${esc(d.periode)} · Édité le ${new Date().toLocaleDateString('fr-FR')}</p></header>
<p><span class="kpi">Heures pointées : <b>${esc(d.heures_hms || d.heures_pointees || '—')}</b></span>
<span class="kpi">Jours travaillés : <b>${esc(d.jours_travailles ?? '—')}</b></span>
<span class="kpi">Statut de la feuille : <b>${esc(d.feuille?.statut ? (STATUT_FEUILLE_LABELS[d.feuille.statut] || d.feuille.statut) : 'brouillon')}</b></span></p>
<h2>Détail par jour</h2>
<table><tr><th>Date</th><th>Heures</th><th>Anomalies</th></tr>
${jours.map((j) => `<tr><td>${esc(j.date)}</td><td>${esc(j.heures_hms ?? j.heures ?? '—')}</td><td>${esc((j.anomalies || []).map((a) => a.type || a).join(', ') || '—')}</td></tr>`).join('')}
</table>
<h2>Pointages bruts de la période</h2>
<table><tr><th>Horodatage (Paris)</th><th>Sens</th><th>Source</th><th>Statut</th></tr>
${(d.pointages || []).map((p) => `<tr><td>${fmtDT(p.horodatage_utc)}</td><td>${esc(SENS_LABELS[p.sens] || p.sens)}</td><td>${esc(p.source)}</td><td>${esc(p.statut)}</td></tr>`).join('')}
</table>
<h2>Corrections apportées (motif tracé, original conservé)</h2>
${(d.corrections || []).length === 0 ? '<p>Aucune correction sur la période.</p>' : `<table><tr><th>Type</th><th>Horodatage corrigé</th><th>Sens</th><th>Motif</th></tr>
${d.corrections.map((c) => `<tr><td>${esc(c.type)}</td><td>${fmtDT(c.horodatage_corrige)}</td><td>${esc(c.sens_corrige ? (SENS_LABELS[c.sens_corrige] || c.sens_corrige) : '—')}</td><td>${esc(c.motif_code)}${c.motif_detail ? ' — ' + esc(c.motif_detail) : ''}</td></tr>`).join('')}</table>`}
<footer>Document remis au salarié — Solidarité Textiles. Vos pointages et leurs corrections sont consultables à tout moment
sur demande auprès de votre encadrant ou du service RH. Toute modification est tracée (auteur, date, motif) ; l'enregistrement
d'origine est toujours conservé.</footer>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}

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

/**
 * Couleur de l'écart théorique/pointé. Un écart NULL (théorique inconnu) est
 * neutre : ce n'est ni un excédent ni un déficit, c'est une inconnue.
 */
function ecartClass(ecart) {
  if (ecart == null) return 'text-slate-400';
  if (ecart > 0.01) return 'text-emerald-700';
  if (ecart < -0.01) return 'text-amber-700';
  return 'text-slate-600';
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

function FeuilleRow({ row, periode, canValidateEncadrant, canValidateRh, isAdmin, onChanged }) {
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

  // Relevé individuel imprimable — la consultation est journalisée côté
  // serveur (BADGEUSE_CONSULTATION) : c'est le document remis au salarié.
  const [relevant, setRelevant] = useState(false);
  const relever = async () => {
    setRelevant(true);
    try {
      const r = await api.get(`/badgeuse/salaries/${row.employee_id}/releve?periode=${periode}`);
      if (!printReleve(r.data)) toast.error('Fenêtre d\'impression bloquée par le navigateur.');
    } catch (err) {
      toast.error(apiErr(err, 'Génération du relevé impossible.'));
    } finally { setRelevant(false); }
  };

  // Dévalidation (ADMIN, journalisée) : la feuille repasse en brouillon et
  // sera recalculée — le chiffre validé cesse de faire foi.
  const [askDevalider, setAskDevalider] = useState(false);
  const [devalidating, setDevalidating] = useState(false);
  const devalider = async () => {
    setDevalidating(true);
    try {
      await api.delete(`/badgeuse/feuilles-temps/${row.employee_id}/validation?periode=${periode}`);
      toast.success('Feuille dévalidée — elle repasse en brouillon.');
      setAskDevalider(false);
      onChanged();
    } catch (err) {
      toast.error(apiErr(err, 'Dévalidation impossible.'));
      setDevalidating(false);
    }
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
        {/* Écart théorique/pointé (BO-04). Théorique inconnu → « — », JAMAIS 0 :
            un écart nul et un écart inconnu ne se confondent pas. */}
        <td className={`py-2 px-2 text-right font-medium ${ecartClass(row.ecart_heures)}`}>
          {row.ecart_heures == null ? (
            <span className="text-slate-300" title="Aucune heure contractuelle connue pour ce salarié sur la période">—</span>
          ) : (
            <>{row.ecart_heures > 0 ? '+' : ''}{fmtHeure(row.ecart_heures)}</>
          )}
        </td>
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
          {isAdmin && row.statut && row.statut !== 'brouillon' && (
            <button onClick={() => setAskDevalider(true)} disabled={devalidating}
              className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50 inline-flex items-center gap-1 ml-3"
              title="Dévalider la feuille (ADMIN, journalisé) — elle repasse en brouillon">
              <Undo2 className="w-3.5 h-3.5" /> Dévalider
            </button>
          )}
          <button onClick={relever} disabled={relevant}
            className="text-xs font-medium text-slate-500 hover:text-teal-700 disabled:opacity-50 inline-flex items-center gap-1 ml-3"
            title="Relevé individuel imprimable à remettre au salarié (consultation journalisée)">
            <Printer className="w-3.5 h-3.5" /> {relevant ? 'Relevé…' : 'Relevé'}
          </button>
          {/* Le dialogue vit DANS la cellule (Modal n'est pas un portail :
              un div entre deux <tr> serait un DOM invalide) — son
              positionnement fixed rend l'emplacement indifférent à l'écran. */}
          {askDevalider && (
            <ConfirmDialog isOpen onCancel={() => setAskDevalider(false)} onConfirm={devalider}
              title="Dévalider la feuille de temps"
              message={`Dévalider la feuille ${periode} de ${employeeName(row)} ? Elle repasse en brouillon : le chiffre validé cesse de faire foi et les corrections redeviennent possibles. L'action est journalisée.`}
              confirmLabel="Dévalider" confirmVariant="danger" loading={devalidating} />
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={7} className="px-4 py-2">
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
export default function FeuillesTemps({ canValidateEncadrant, canValidateRh, canExport, isAdmin }) {
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
                  <th className="text-right py-2 px-2">Écart</th>
                  <th className="text-right py-2 px-2">Validées</th>
                  <th className="text-center py-2 px-2">Statut</th>
                  <th className="text-right py-2 px-2">Circuit de validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <FeuilleRow key={row.employee_id} row={row} periode={periode}
                    canValidateEncadrant={canValidateEncadrant} canValidateRh={canValidateRh}
                    isAdmin={isAdmin} onChanged={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          Statuts : {Object.entries(STATUT_FEUILLE_LABELS).map(([k, l]) => l).join(' → ')}. Une feuille dévalidée relève d'un ADMIN (journalisé).
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          Heures théoriques = heures hebdomadaires contractuelles au 1<sup>er</sup> du mois × jours ouvrés du mois ÷ 5.
          Un « — » signifie qu'aucune heure contractuelle n'est connue pour ce salarié sur la période : l'écart n'est alors
          pas calculable et n'est jamais affiché comme nul.
        </p>
      </div>
    </div>
  );
}
