import { useState, useEffect, useCallback, useMemo } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, ErrorState, Modal, KPICard } from '../components';
import {
  Gauge, LayoutDashboard, Grid3x3, GitCompare, Settings, Download, RefreshCw,
  AlertTriangle, CheckCircle2, TrendingUp, Users, Info,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { formatEmployeeName, compareByName } from '../utils/names';

// ═══════════════════════════════════════════════════════════════════════════
// Module « Effectifs conventionnés (ETP) » — suivi prévisionnel/réalisé des
// ETP d'insertion vs convention ACI (annexe financière). Consomme l'API
// /api/effectifs telle que définie par le contrat (agent backend en
// parallèle) : lecture ADMIN/RH/MANAGER, écritures (paramètres + ASP)
// ADMIN/RH, suppression de la validation ASP ADMIN uniquement.
//
// Doctrine « jamais de valeur inventée » : quand la convention n'est pas
// paramétrée pour l'année, les indicateurs affichent « — » et un bandeau
// avertit — jamais un 0 qui laisserait croire à une convention à zéro ETP.
// ═══════════════════════════════════════════════════════════════════════════

// ── Constantes ────────────────────────────────────────────────────────────
const MOIS_COURT = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const MOIS_LONG = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// ── Formateurs (nombres FR, 2 décimales par défaut) ─────────────────────────
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const fmtNum = (v, digits = 2) => {
  const n = num(v);
  return n == null ? '—' : n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtSigned = (v, digits = 2) => {
  const n = num(v);
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${fmtNum(n, digits)}`;
};
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-FR');
};
const fmtDateTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleString('fr-FR');
};
const apiErr = (err, fallback = 'Une erreur est survenue.') => err?.response?.data?.error || err?.message || fallback;

const yearsList = () => {
  const y = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => y + 1 - i); // année+1 → année-4
};

// `mois` est conventionnellement un entier 1-12 dans toute l'application
// (BoutiquesObjectifs, Énergie & GES…) ; formateur tolérant si jamais une
// autre forme arrivait un jour.
const moisLabel = (m, long = false) => {
  const idx = Number(m) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx > 11) return String(m ?? '—');
  return (long ? MOIS_LONG : MOIS_COURT)[idx];
};

const isFutureMonth = (annee, mn) => {
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  return annee > curY || (annee === curY && mn > curM);
};

const avgOf = (list, key) => {
  const vals = (list || []).map((m) => num(m[key])).filter((v) => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

const avgRealiseADate = (mois, annee) => {
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const relevant = (mois || []).filter((m) => {
    const mn = Number(m.mois);
    if (annee < curY) return true;
    if (annee > curY) return false;
    return mn <= curM;
  });
  return avgOf(relevant, 'etp_realise');
};

// Le contrat n'expose qu'un champ `nom` déjà formaté (pas de last/first_name
// séparés). On respecte quand même la convention « NOM Prénom » du helper
// partagé si jamais des champs séparés étaient présents (repli défensif) ;
// sinon on affiche `nom` tel que fourni par le backend, qui applique déjà
// la règle de nommage du projet (CLAUDE.md §7).
const displayName = (p) => {
  if (p?.last_name || p?.first_name) return formatEmployeeName(p.last_name, p.first_name);
  return p?.nom || '—';
};
const sortByName = (list) => [...(list || [])].sort((a, b) => {
  if ((a?.last_name || a?.first_name) && (b?.last_name || b?.first_name)) return compareByName(a, b);
  return String(a?.nom || '').localeCompare(String(b?.nom || ''), 'fr', { sensitivity: 'base' });
});

// ── Bandeau « convention non paramétrée » ───────────────────────────────────
function ConventionWarning() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2 flex items-start gap-2 mb-4" role="note">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <span>
        Convention non paramétrée pour cette année — les indicateurs affichent « — » tant que l'annexe financière
        n'a pas été saisie dans l'onglet <strong>Paramètres</strong>.
      </span>
    </div>
  );
}

// Badge de statut mensuel (position calendaire + validation ASP).
function statutBadge(annee, mn, aspValidated) {
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  if (annee > curY || (annee === curY && mn > curM)) return { label: 'À venir', cls: 'bg-slate-100 text-slate-500' };
  if (annee === curY && mn === curM) return { label: 'En cours', cls: 'bg-blue-100 text-blue-700' };
  return aspValidated
    ? { label: 'Clos', cls: 'bg-emerald-100 text-emerald-700' }
    : { label: 'À valider', cls: 'bg-amber-100 text-amber-700' };
}

// Cellule « écart vs convention » — priorité à l'écart ASP (validé, source la
// plus fiable) sinon repli sur l'écart prévisionnel ERP ; jamais 0 inventé.
function EcartCell({ m, convention }) {
  if (!convention) return <span className="text-slate-300">—</span>;
  const useAsp = m.ecart_convention_asp != null;
  const val = useAsp ? m.ecart_convention_asp : m.ecart_convention_prev;
  if (val == null) return <span className="text-slate-300">—</span>;
  const n = Number(val);
  return (
    <span
      className={`font-semibold ${n < 0 ? 'text-red-600' : 'text-emerald-600'}`}
      title={useAsp ? 'Écart calculé sur la base ASP validée' : 'Écart calculé sur la base du prévisionnel ERP (aucune saisie ASP validée pour ce mois)'}
    >
      {fmtSigned(n, 2)} <span className="text-[10px] font-normal text-slate-400">{useAsp ? '(ASP)' : '(prév.)'}</span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Modale de saisie / validation ASP (POST /effectifs/asp/:annee/:mois,
// DELETE réservé ADMIN)
// ═══════════════════════════════════════════════════════════════════════════
function AspModal({ open, month, annee, convention, onClose, onSaved }) {
  const { user } = useAuth();
  const isAdmin = (user?.base_role || user?.role) === 'ADMIN';

  const [etpAsp, setEtpAsp] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && month) {
      setEtpAsp(month.etp_asp != null ? String(month.etp_asp) : '');
      setCommentaire(month.asp_commentaire || '');
      setError(null);
    }
  }, [open, month]);

  const ecartLive = useMemo(() => {
    const n = num(etpAsp);
    if (n == null || convention?.etp_conventionnes == null) return null;
    return n - Number(convention.etp_conventionnes);
  }, [etpAsp, convention]);

  if (!month) return null;

  const save = async () => {
    const n = num(etpAsp);
    if (n == null) { setError('Merci de saisir un ETP ASP valide.'); return; }
    setSaving(true); setError(null);
    try {
      await api.post(`/effectifs/asp/${annee}/${month.mois}`, { etp_asp: n, commentaire });
      onSaved();
      onClose();
    } catch (err) {
      setError(apiErr(err, "Échec de l'enregistrement"));
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!window.confirm('Supprimer la validation ASP de ce mois ?')) return;
    setSaving(true); setError(null);
    try {
      await api.delete(`/effectifs/asp/${annee}/${month.mois}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(apiErr(err, 'Échec de la suppression'));
    }
    setSaving(false);
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={`Validation ASP — ${moisLabel(month.mois, true)} ${annee}`} size="sm">
      <div className="space-y-3">
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          Rappel — calcul ERP du mois (réalisé) : <strong>{fmtNum(month.etp_realise, 2)} ETP</strong>
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">ETP ASP *</label>
          <input type="number" step="0.01" value={etpAsp} onChange={(e) => setEtpAsp(e.target.value)} className="input-modern w-full text-sm" placeholder="ex. 22,50" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Commentaire</label>
          <textarea rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} className="input-modern w-full text-sm" />
        </div>
        <p className="text-xs">
          Écart vs convention (aperçu) :{' '}
          {ecartLive != null ? (
            <span className={`font-semibold ${ecartLive < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtSigned(ecartLive, 2)} ETP</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-between items-center pt-1">
          {isAdmin && month.etp_asp != null ? (
            <button onClick={remove} disabled={saving} className="text-xs text-red-600 hover:underline disabled:opacity-50">
              Supprimer la validation
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Annuler</button>
            <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Onglet 1 — Synthèse mensuelle (GET /effectifs/synthese)
// ═══════════════════════════════════════════════════════════════════════════
function SyntheseTab({ annee, setAnnee, canWrite }) {
  const [synthese, setSynthese] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalMonth, setModalMonth] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get(`/effectifs/synthese?annee=${annee}`)
      .then((r) => setSynthese(r.data))
      .catch((err) => setError(apiErr(err, 'Chargement de la synthèse impossible')))
      .finally(() => setLoading(false));
  }, [annee]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner size="lg" message="Chargement de la synthèse…" />;
  if (error) return <ErrorState variant="card" title="Synthèse indisponible" message={error} onRetry={load} />;
  if (!synthese) return null;

  const convention = synthese.convention || null;
  const mois = synthese.mois || [];
  const besoins = (synthese.besoins_recrutement || []).filter((b) => Number(b.etp_manquants) > 0 && isFutureMonth(annee, Number(b.mois)));

  const kpiPrev = avgOf(mois, 'etp_previsionnel');
  const kpiRealise = avgRealiseADate(mois, annee);
  const kpiTaux = avgOf(mois, 'taux_realisation');

  const chartData = mois.map((m) => ({
    label: moisLabel(m.mois),
    previsionnel: num(m.etp_previsionnel),
    realise: num(m.etp_realise),
    asp: num(m.etp_asp),
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor="synthese-annee" className="text-sm text-slate-500">Année</label>
        <select id="synthese-annee" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className="input-modern text-sm py-1.5 w-auto">
          {yearsList().map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={load} className="text-xs text-slate-400 hover:text-teal-700 inline-flex items-center gap-1" title="Actualiser">
          <RefreshCw className="w-3.5 h-3.5" /> Actualiser
        </button>
      </div>

      {!convention && <ConventionWarning />}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="ETP conventionnés" value={convention?.etp_conventionnes != null ? fmtNum(convention.etp_conventionnes, 2) : '—'} unit="ETP" icon={Gauge} accent="primary" />
        <KPICard title="Prévisionnel annuel moyen" value={kpiPrev != null ? fmtNum(kpiPrev, 2) : '—'} unit="ETP" icon={TrendingUp} accent="slate" />
        <KPICard title="Réalisé moyen à date" value={kpiRealise != null ? fmtNum(kpiRealise, 2) : '—'} unit="ETP" icon={Users} accent="emerald" />
        <KPICard title="Taux de réalisation" value={kpiTaux != null ? fmtNum(kpiTaux, 1) : '—'} unit={kpiTaux != null ? '%' : ''} icon={CheckCircle2} accent="amber" />
      </div>

      {/* Graphe */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="text-sm font-bold text-slate-700 mb-1">Évolution mensuelle</h3>
        <p className="text-xs text-slate-400 mb-3">Prévisionnel, réalisé (calcul ERP) et ASP validé — ligne de référence : convention.</p>
        {chartData.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">Aucune donnée pour {annee}.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v, name) => [v != null ? `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ETP` : '—', name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="previsionnel" name="Prévisionnel" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="realise" name="Réalisé" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              <Line type="monotone" dataKey="asp" name="ASP validé" stroke="#059669" strokeWidth={2} strokeDasharray="4 2" dot={{ r: 3 }} connectNulls />
              {convention?.etp_conventionnes != null && (
                <ReferenceLine y={Number(convention.etp_conventionnes)} stroke="#dc2626" strokeDasharray="5 3"
                  label={{ value: 'Convention', position: 'right', fontSize: 10, fill: '#dc2626' }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Besoins de recrutement */}
      {besoins.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-bold text-amber-800 flex items-center gap-1.5 mb-2">
            <AlertTriangle className="w-4 h-4" /> Besoins de recrutement (mois à venir)
          </h3>
          <div className="flex flex-wrap gap-2">
            {besoins.map((b) => {
              const manquants = Number(b.etp_manquants);
              const tone = manquants >= 1 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-amber-100 text-amber-700 border-amber-200';
              return (
                <span key={b.mois} className={`text-xs font-medium px-2.5 py-1 rounded-full border ${tone}`}>
                  {moisLabel(b.mois)} : {fmtNum(manquants, 2)} ETP manquant{manquants >= 2 ? 's' : ''}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Tableau 12 mois */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="text-sm font-bold text-slate-700 mb-3">Détail mensuel {annee}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-2">Mois</th>
                <th className="py-2 px-2 text-right">Prévisionnel</th>
                <th className="py-2 px-2 text-right">Réalisé (calcul)</th>
                <th className="py-2 px-2 text-center">ASP validé</th>
                <th className="py-2 px-2 text-right">Écart vs convention</th>
                <th className="py-2 px-2 text-right">Taux de réalisation</th>
                <th className="py-2 pl-2 text-center">Statut</th>
              </tr>
            </thead>
            <tbody>
              {mois.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-slate-400 py-6">Aucune donnée pour {annee}.</td></tr>
              ) : mois.map((m) => {
                const mn = Number(m.mois);
                const st = statutBadge(annee, mn, m.etp_asp != null);
                const aspTitle = [
                  m.asp_valide_par ? `Par ${m.asp_valide_par}` : null,
                  m.asp_valide_le ? `le ${fmtDateTime(m.asp_valide_le)}` : null,
                  m.asp_commentaire ? `— ${m.asp_commentaire}` : null,
                ].filter(Boolean).join(' ') || 'Validé';
                return (
                  <tr key={mn} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="py-2 pr-2 font-medium text-slate-700">{moisLabel(mn)}</td>
                    <td className="py-2 px-2 text-right">{fmtNum(m.etp_previsionnel, 2)}</td>
                    <td className="py-2 px-2 text-right">{fmtNum(m.etp_realise, 2)}</td>
                    <td className="py-2 px-2 text-center">
                      {m.etp_asp != null ? (
                        canWrite ? (
                          <button onClick={() => setModalMonth(m)} title={aspTitle}
                            className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Validé ASP ({fmtNum(m.etp_asp, 2)})
                          </button>
                        ) : (
                          <span title={aspTitle} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 cursor-help">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Validé ASP ({fmtNum(m.etp_asp, 2)})
                          </span>
                        )
                      ) : canWrite ? (
                        <button onClick={() => setModalMonth(m)} className="text-xs text-teal-700 hover:underline font-medium">Saisir ASP</button>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right"><EcartCell m={m} convention={convention} /></td>
                    <td className="py-2 px-2 text-right">{m.taux_realisation != null ? `${fmtNum(m.taux_realisation, 1)} %` : '—'}</td>
                    <td className="py-2 pl-2 text-center">
                      <span className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AspModal open={!!modalMonth} month={modalMonth} annee={annee} convention={convention} onClose={() => setModalMonth(null)} onSaved={load} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Grille ETP type Excel — partagée par les onglets « Grille prévisionnelle »
// et « Réalisé & écarts » (GET /effectifs/grille?vue=previsionnel|realise)
// ═══════════════════════════════════════════════════════════════════════════
function groupWeeksByMonth(semaines) {
  const groups = [];
  for (const s of semaines) {
    const last = groups[groups.length - 1];
    if (last && last.mois === s.mois) last.weeks.push(s);
    else groups.push({ mois: s.mois, weeks: [s] });
  }
  return groups;
}

function QuotiteCell({ q, vue, passIaeEnd }) {
  if (!q || q.q == null) return <td className="border-r border-slate-100 px-1 py-1" />;

  const val = fmtNum(q.q, 2);
  let cls = 'text-slate-700';
  let title;
  let hatch = false;

  if (vue === 'previsionnel') {
    if (q.statut === 'signe') {
      cls = 'bg-emerald-200/80 text-emerald-900 font-semibold';
      title = 'Renouvellement signé';
    } else if (q.statut === 'presume') {
      cls = 'text-amber-800 font-medium';
      title = `Renouvellement présumé jusqu'au Pass IAE${passIaeEnd ? ` (${fmtDate(passIaeEnd)})` : ''}`;
      hatch = true;
    }
  } else {
    if (q.statut === 'realise') {
      cls = 'bg-teal-200/80 text-teal-900 font-semibold';
      title = 'Semaine réalisée';
    } else if (q.statut === 'a_venir') {
      cls = 'bg-slate-100 text-slate-400';
      title = 'Semaine à venir (non encore réalisée)';
    }
  }

  const style = hatch ? {
    backgroundImage: 'repeating-linear-gradient(45deg, rgba(217,119,6,0.20), rgba(217,119,6,0.20) 4px, rgba(217,119,6,0.06) 4px, rgba(217,119,6,0.06) 8px)',
  } : undefined;

  return (
    <td className={`border-r border-slate-100 px-1 py-1 text-center text-[11px] ${cls}`} style={style} title={title}>
      {val}
    </td>
  );
}

function PersonRow({ personne, semaines, vue }) {
  const bySemaine = {};
  (personne.quotites || []).forEach((q) => { bySemaine[q.s] = q; });

  return (
    <tr className="hover:bg-slate-50/60">
      <td className="sticky left-0 z-10 bg-white border-r border-b border-slate-100 px-2 py-1 text-slate-700 whitespace-nowrap text-xs">
        {displayName(personne)}
        {personne.pass_iae_end && (
          <span className="block text-[9px] text-slate-400">Pass IAE au {fmtDate(personne.pass_iae_end)}</span>
        )}
        {!personne.pass_iae_end && personne.fin_dernier_contrat && (
          <span className="block text-[9px] text-slate-400">Contrat au {fmtDate(personne.fin_dernier_contrat)}</span>
        )}
      </td>
      {semaines.map((s) => (
        <QuotiteCell key={s.num} q={bySemaine[s.num]} vue={vue} passIaeEnd={personne.pass_iae_end} />
      ))}
    </tr>
  );
}

function SectionRows({ section, semaines, vue }) {
  const totalBySemaine = {};
  (section.totaux_semaine || []).forEach((t) => { totalBySemaine[t.s] = t.etp; });
  const personnes = sortByName(section.personnes);

  return (
    <>
      <tr>
        <td colSpan={semaines.length + 1} className="sticky left-0 bg-teal-50 border-b border-r border-slate-100 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-teal-700">
          {section.team_name || 'Sans équipe'}
        </td>
      </tr>
      {personnes.length === 0 ? (
        <tr>
          <td colSpan={semaines.length + 1} className="sticky left-0 bg-white border-b border-r border-slate-100 px-2 py-2 text-[11px] text-slate-400 italic">
            Aucun salarié en parcours dans cette équipe.
          </td>
        </tr>
      ) : personnes.map((p) => (
        <PersonRow key={p.employee_id} personne={p} semaines={semaines} vue={vue} />
      ))}
      <tr className="bg-slate-50 font-semibold">
        <td className="sticky left-0 z-10 bg-slate-50 border-r border-b border-slate-100 px-2 py-1 text-slate-600 text-[11px]">
          TOTAL {section.team_name || ''}
        </td>
        {semaines.map((s) => (
          <td key={s.num} className="border-r border-b border-slate-100 px-1 py-1 text-center text-[11px] text-slate-600">
            {totalBySemaine[s.num] != null ? fmtNum(totalBySemaine[s.num], 2) : '—'}
          </td>
        ))}
      </tr>
    </>
  );
}

function GrilleETP({ annee, vue }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get(`/effectifs/grille?annee=${annee}&vue=${vue}`)
      .then((r) => setData(r.data))
      .catch((err) => setError(apiErr(err, 'Chargement de la grille impossible')))
      .finally(() => setLoading(false));
  }, [annee, vue]);

  useEffect(() => { load(); }, [load]);

  const exportXlsx = async () => {
    setExporting(true); setExportError(null);
    try {
      const res = await api.get(`/effectifs/export?annee=${annee}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `effectifs_etp_${annee}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      let msg = "Échec de l'export.";
      try { const txt = await err.response?.data?.text?.(); if (txt) msg = JSON.parse(txt).error || msg; } catch { /* garde le message générique */ }
      setExportError(msg);
    }
    setExporting(false);
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement de la grille…" />;
  if (error) return <ErrorState variant="card" title="Grille indisponible" message={error} onRetry={load} />;
  if (!data) return null;

  const semaines = data.semaines || [];
  const sections = data.sections || [];
  const convention = data.convention || null;
  const monthGroups = groupWeeksByMonth(semaines);
  const totalBySemaine = {};
  (data.totaux?.par_semaine || []).forEach((t) => { totalBySemaine[t.s] = t.etp; });

  return (
    <div>
      {!convention && <ConventionWarning />}

      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-xs text-slate-500">
          {vue === 'previsionnel' ? (
            <>Fond <strong className="text-emerald-700">vert plein</strong> = renouvellement signé · <strong className="text-amber-700">hachuré</strong> = renouvellement présumé jusqu'au Pass IAE.</>
          ) : (
            <>Fond <strong className="text-teal-700">plein</strong> = semaine réalisée · <strong className="text-slate-500">grisé</strong> = semaine à venir.</>
          )}
        </p>
        <button onClick={exportXlsx} disabled={exporting} className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          <Download className="w-4 h-4" strokeWidth={1.8} /> {exporting ? 'Export…' : 'Exporter (Excel)'}
        </button>
      </div>
      {exportError && <p className="text-xs text-red-600 mb-2">{exportError}</p>}

      {semaines.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-10">Aucune semaine calculable pour {annee}.</p>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="border-collapse w-max min-w-full">
              <thead>
                <tr>
                  <th rowSpan={2} className="sticky left-0 z-20 bg-slate-100 border-b border-r border-slate-200 px-2 py-1.5 text-left text-xs font-semibold text-slate-600 min-w-[190px]">
                    Salarié
                  </th>
                  {monthGroups.map((g) => (
                    <th key={`${g.mois}-${g.weeks[0].num}`} colSpan={g.weeks.length}
                      className="border-b border-r border-slate-200 bg-slate-100 px-1 py-1 text-center text-xs font-semibold text-slate-600">
                      {moisLabel(g.mois)}
                    </th>
                  ))}
                </tr>
                <tr>
                  {semaines.map((s) => (
                    <th key={s.num} className="border-b border-r border-slate-100 bg-slate-50 px-1 py-1 text-center text-[10px] font-medium text-slate-500 min-w-[34px]" title={`Semaine du ${fmtDate(s.lundi)}`}>
                      S{s.num}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.length === 0 ? (
                  <tr><td colSpan={semaines.length + 1} className="text-center text-slate-400 py-6 text-sm">Aucune personne en parcours pour {annee}.</td></tr>
                ) : sections.map((sec) => (
                  <SectionRows key={sec.team_id ?? sec.team_name} section={sec} semaines={semaines} vue={vue} />
                ))}

                {/* TOTAL général */}
                <tr className="bg-slate-200/70 font-bold">
                  <td className="sticky left-0 z-10 bg-slate-200/70 border-r border-slate-200 px-2 py-1.5 text-slate-800 text-xs">TOTAL général</td>
                  {semaines.map((s) => {
                    const v = totalBySemaine[s.num];
                    const over = convention?.etp_conventionnes != null && v != null && Number(v) > Number(convention.etp_conventionnes);
                    return (
                      <td key={s.num} className={`border-r border-slate-200 px-1 py-1.5 text-center text-[11px] ${over ? 'text-red-700 bg-red-100' : 'text-slate-800'}`}
                        title={over ? 'Dépasse la convention cette semaine' : undefined}>
                        {v != null ? fmtNum(v, 2) : '—'}
                      </td>
                    );
                  })}
                </tr>

                {/* Convention (référence) */}
                <tr>
                  <td className="sticky left-0 z-10 bg-white border-r border-slate-200 px-2 py-1.5 text-slate-500 italic text-xs">Convention</td>
                  {semaines.map((s) => (
                    <td key={s.num} className="border-r border-slate-100 px-1 py-1.5 text-center text-[11px] text-slate-400 italic">
                      {convention?.etp_conventionnes != null ? fmtNum(convention.etp_conventionnes, 2) : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Onglet 2 — Grille prévisionnelle
// ═══════════════════════════════════════════════════════════════════════════
function PrevisionnelTab({ annee, setAnnee }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="prev-annee" className="text-sm text-slate-500">Année</label>
        <select id="prev-annee" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className="input-modern text-sm py-1.5 w-auto">
          {yearsList().map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <GrilleETP annee={annee} vue="previsionnel" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Onglet 3 — Réalisé & écarts
// ═══════════════════════════════════════════════════════════════════════════
function RealiseTab({ annee, setAnnee }) {
  const [compact, setCompact] = useState(false);
  const [ecarts, setEcarts] = useState([]);
  const [loadingEcarts, setLoadingEcarts] = useState(true);
  const [errorEcarts, setErrorEcarts] = useState(null);
  const [tousFiltre, setTousFiltre] = useState(false);
  const [teamFiltre, setTeamFiltre] = useState('');

  const loadEcarts = useCallback(() => {
    setLoadingEcarts(true); setErrorEcarts(null);
    api.get(`/effectifs/ecarts?annee=${annee}${tousFiltre ? '&tous=1' : ''}`)
      .then((r) => setEcarts(r.data || []))
      .catch((err) => setErrorEcarts(apiErr(err, 'Chargement des écarts impossible')))
      .finally(() => setLoadingEcarts(false));
  }, [annee, tousFiltre]);

  useEffect(() => { loadEcarts(); }, [loadEcarts]);

  const teams = useMemo(() => {
    const s = new Set();
    ecarts.forEach((e) => { if (e.team_name) s.add(e.team_name); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [ecarts]);

  const rows = useMemo(() => {
    const out = [];
    sortByName(ecarts.filter((e) => !teamFiltre || e.team_name === teamFiltre)).forEach((e, idx) => {
      (e.mois || []).forEach((m) => {
        out.push({ ...m, employee_id: e.employee_id, nom: displayName(e), team_name: e.team_name, _group: idx % 2 });
      });
    });
    return out;
  }, [ecarts, teamFiltre]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor="real-annee" className="text-sm text-slate-500">Année</label>
          <select id="real-annee" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className="input-modern text-sm py-1.5 w-auto">
            {yearsList().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={() => setCompact((c) => !c)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
          <Grid3x3 className="w-4 h-4" strokeWidth={1.8} /> {compact ? 'Afficher la grille complète' : 'Vue compacte (masquer la grille)'}
        </button>
      </div>

      {!compact && <GrilleETP annee={annee} vue="realise" />}

      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="text-sm font-bold text-slate-700">Écarts prévisionnel / réalisé par personne</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <select value={teamFiltre} onChange={(e) => setTeamFiltre(e.target.value)} className="input-modern text-xs py-1 w-auto">
              <option value="">Toutes les équipes</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="text-xs text-slate-500 inline-flex items-center gap-1.5">
              <input type="checkbox" checked={tousFiltre} onChange={(e) => setTousFiltre(e.target.checked)} />
              Tous (pas seulement les écarts)
            </label>
          </div>
        </div>

        {loadingEcarts ? (
          <LoadingSpinner message="Chargement des écarts…" />
        ) : errorEcarts ? (
          <ErrorState variant="card" title="Écarts indisponibles" message={errorEcarts} onRetry={loadEcarts} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">
            {tousFiltre ? 'Aucune donnée pour ce filtre.' : 'Aucun écart détecté.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-2">Personne</th>
                  <th className="py-2 px-2">Équipe</th>
                  <th className="py-2 px-2">Mois</th>
                  <th className="py-2 px-2 text-right">Prévisionnel</th>
                  <th className="py-2 px-2 text-right">Réalisé</th>
                  <th className="py-2 px-2 text-right">Écart</th>
                  <th className="py-2 pl-2 text-right">Jours d'absence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.employee_id}-${r.mois}-${i}`} className={`border-b border-slate-50 ${r._group ? 'bg-slate-50/50' : ''}`}>
                    <td className="py-1.5 pr-2 font-medium text-slate-700 whitespace-nowrap">{r.nom}</td>
                    <td className="py-1.5 px-2 text-slate-500">{r.team_name || '—'}</td>
                    <td className="py-1.5 px-2 text-slate-500">{moisLabel(r.mois)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtNum(r.previsionnel, 2)}</td>
                    <td className="py-1.5 px-2 text-right">{fmtNum(r.realise, 2)}</td>
                    <td className={`py-1.5 px-2 text-right font-semibold ${num(r.ecart) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {fmtSigned(r.ecart, 2)}
                    </td>
                    <td className="py-1.5 pl-2 text-right text-slate-500">{r.jours_absence ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Onglet 4 — Paramètres (annexe financière) — ADMIN/RH
// ═══════════════════════════════════════════════════════════════════════════
const SOURCE_LABELS = {
  annee: 'Paramétré directement pour cette année.',
  cible_insertion: "Repli : valeur issue de la cible d'insertion (aucun paramétrage propre à cette année).",
  defaut: 'Valeur par défaut du système (aucun paramétrage trouvé).',
};

const EMPTY_PARAMS = { etp_conventionnes: '', etp_cdi_inclusion: '', heures_annuelles_etp: '', date_debut: '', date_fin: '' };

function ParametresTab({ annee, setAnnee }) {
  const [params, setParams] = useState(null);
  const [form, setForm] = useState(EMPTY_PARAMS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null); setSaved(false);
    api.get(`/effectifs/parametres?annee=${annee}`)
      .then((r) => {
        setParams(r.data);
        setForm(r.data ? {
          etp_conventionnes: r.data.etp_conventionnes ?? '',
          etp_cdi_inclusion: r.data.etp_cdi_inclusion ?? '',
          heures_annuelles_etp: r.data.heures_annuelles_etp ?? '',
          date_debut: r.data.date_debut ? String(r.data.date_debut).slice(0, 10) : '',
          date_fin: r.data.date_fin ? String(r.data.date_fin).slice(0, 10) : '',
        } : EMPTY_PARAMS);
      })
      .catch((err) => setError(apiErr(err, 'Chargement des paramètres impossible')))
      .finally(() => setLoading(false));
  }, [annee]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (num(form.etp_conventionnes) == null) { setError('ETP conventionnés est obligatoire.'); return; }
    setSaving(true); setError(null); setSaved(false);
    try {
      await api.put('/effectifs/parametres', {
        annee,
        etp_conventionnes: num(form.etp_conventionnes),
        etp_cdi_inclusion: num(form.etp_cdi_inclusion),
        heures_annuelles_etp: num(form.heures_annuelles_etp),
        date_debut: form.date_debut || null,
        date_fin: form.date_fin || null,
      });
      setSaved(true);
      await load();
    } catch (err) {
      setError(apiErr(err, "Échec de l'enregistrement"));
    }
    setSaving(false);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="param-annee" className="text-sm text-slate-500">Année</label>
        <select id="param-annee" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className="input-modern text-sm py-1.5 w-auto">
          {yearsList().map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading ? (
        <LoadingSpinner message="Chargement…" />
      ) : error && !params ? (
        <ErrorState variant="card" title="Paramètres indisponibles" message={error} onRetry={load} />
      ) : (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-start gap-2 text-xs rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" />
            <span className="text-slate-500">
              {params?.source ? (SOURCE_LABELS[params.source] || 'Source inconnue.') : 'Aucune valeur paramétrée pour cette année — la première saisie ci-dessous la créera.'}
            </span>
          </div>

          <p className="text-xs text-slate-400">
            Valeurs de votre annexe financière — ex. 25,17 ETP conventionnés, 1 820 h annuelles par ETP.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">ETP conventionnés *</label>
              <input type="number" step="0.01" min="0" value={form.etp_conventionnes}
                onChange={(e) => setForm((f) => ({ ...f, etp_conventionnes: e.target.value }))}
                className="input-modern w-full text-sm" placeholder="ex. 25,17" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Dont CDI Inclusion</label>
              <input type="number" step="0.01" min="0" value={form.etp_cdi_inclusion}
                onChange={(e) => setForm((f) => ({ ...f, etp_cdi_inclusion: e.target.value }))}
                className="input-modern w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Heures annuelles / ETP</label>
              <input type="number" step="1" min="0" value={form.heures_annuelles_etp}
                onChange={(e) => setForm((f) => ({ ...f, heures_annuelles_etp: e.target.value }))}
                className="input-modern w-full text-sm" placeholder="ex. 1820" />
            </div>
            <div />
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Date de début</label>
              <input type="date" value={form.date_debut}
                onChange={(e) => setForm((f) => ({ ...f, date_debut: e.target.value }))}
                className="input-modern w-full text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Date de fin</label>
              <input type="date" value={form.date_fin}
                onChange={(e) => setForm((f) => ({ ...f, date_fin: e.target.value }))}
                className="input-modern w-full text-sm" />
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {saved && !error && <p className="text-xs text-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Paramètres enregistrés.</p>}

          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Composant principal — page à 4 onglets
// ═══════════════════════════════════════════════════════════════════════════
export default function EffectifsETP() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const canWrite = ['ADMIN', 'RH'].includes(base); // paramètres + validation ASP

  const [tab, setTab] = useState('synthese');
  const [annee, setAnnee] = useState(new Date().getFullYear());

  const TABS = [
    { id: 'synthese', label: 'Synthèse mensuelle', icon: LayoutDashboard, show: true },
    { id: 'previsionnel', label: 'Grille prévisionnelle', icon: Grid3x3, show: true },
    { id: 'realise', label: 'Réalisé & écarts', icon: GitCompare, show: true },
    { id: 'parametres', label: 'Paramètres', icon: Settings, show: canWrite },
  ].filter((t) => t.show);

  return (
    <Layout>
      <div className="p-4 sm:p-6">
        <PageHeader
          title="Effectifs conventionnés (ETP)"
          subtitle="Suivi prévisionnel et réalisé des ETP d'insertion vs convention ACI"
          icon={Gauge}
        />

        {/* Onglets */}
        <div className="border-b border-slate-200 mb-5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  aria-current={active ? 'page' : undefined}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'synthese' && <SyntheseTab annee={annee} setAnnee={setAnnee} canWrite={canWrite} />}
        {tab === 'previsionnel' && <PrevisionnelTab annee={annee} setAnnee={setAnnee} />}
        {tab === 'realise' && <RealiseTab annee={annee} setAnnee={setAnnee} />}
        {tab === 'parametres' && canWrite && <ParametresTab annee={annee} setAnnee={setAnnee} />}
      </div>
    </Layout>
  );
}
