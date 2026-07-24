import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, Legend,
} from 'recharts';
import {
  Building2, CheckCircle2, Percent, FileWarning, RefreshCw, Euro, AlertTriangle,
} from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState } from '../index';
import {
  StatCard, categorieLabel, STATUT_FLAGS, STATUT_COLORS, fmtEur, partSourceLabel, yearsList, apiErr,
} from './achatsShared';

// ── Bloc « part d'achats responsables en montant » (doctrine jamais de faux chiffre) ──
function MontantBlock({ montant }) {
  const m = montant || {};
  const dispo = m.part_montant_pct != null;
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-center gap-2 mb-1">
        <Euro className="w-4 h-4 text-emerald-600" />
        <h3 className="font-semibold text-slate-800">Part d'achats responsables en montant{m.annee ? ` (${m.annee})` : ''}</h3>
      </div>
      {dispo ? (
        <>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-bold text-emerald-700">{m.part_montant_pct} %</span>
            <span className="text-xs text-slate-500">({partSourceLabel(m.part_source)})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div className="rounded-lg border border-slate-100 p-3">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Achats responsables</div>
              <div className="mt-0.5 text-lg font-bold text-slate-800">{fmtEur(m.montant_responsables)}</div>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Total achats (classe 60)</div>
              <div className="mt-0.5 text-lg font-bold text-slate-800">{fmtEur(m.total_classe_60)}</div>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <div className="text-[11px] text-slate-500 uppercase tracking-wide">Fournisseurs rapprochés</div>
              <div className="mt-0.5 text-lg font-bold text-slate-800">{m.fournisseurs_rapproches ?? 0}</div>
            </div>
          </div>
        </>
      ) : (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-3 py-2 flex items-start gap-2" role="note">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>Part en montant indisponible — rapprochement comptable requis.</span>
        </div>
      )}
      {m.note && <p className="text-[11px] text-slate-400 mt-2">{m.note}</p>}
    </div>
  );
}

// Onglet « Tableau de bord » : KPI, part en montant, répartition (statut + famille),
// liste des FDS à traiter.
export default function DashboardAchats() {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/achats/dashboard?annee=${annee}`)
      .then((r) => { setDash(r.data); setError(null); })
      .catch((err) => setError(apiErr(err)))
      .finally(() => setLoading(false));
  }, [annee]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSpinner size="lg" message="Chargement du tableau de bord achats…" />;
  if (error) return <ErrorState variant="card" title="Tableau de bord indisponible" message={error} onRetry={load} />;
  if (!dash) return null;

  const f = dash.fournisseurs || {};
  const fds = dash.fds || {};
  const criteres = dash.criteres || {};
  const totalF = f.total || 0;

  const statutData = STATUT_FLAGS.map((s) => ({ key: s.key, statut: s.label, count: f[s.key] || 0 }));
  const familleData = (f.par_famille || []).map((r) => ({
    famille: categorieLabel(r.famille), total: r.total || 0, responsables: r.responsables || 0,
  }));
  const listeATraiter = fds.liste_a_traiter || [];

  return (
    <div className="space-y-5">
      {/* Sélecteur d'année + actualiser */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <label htmlFor="achats-year" className="text-sm text-slate-500">Année</label>
        <select id="achats-year" value={annee} onChange={(e) => setAnnee(Number(e.target.value))}
          className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
          {yearsList().map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={load} className="text-xs text-slate-400 hover:text-emerald-700 inline-flex items-center gap-1" title="Actualiser">
          <RefreshCw className="w-3.5 h-3.5" /> Actualiser
        </button>
      </div>

      {/* KPI principaux */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Building2} label="Fournisseurs" value={totalF}
          sub={`${f.actifs ?? 0} actif${(f.actifs ?? 0) > 1 ? 's' : ''}`} tone="slate" />
        <StatCard icon={CheckCircle2} label="Fournisseurs responsables" value={f.responsables ?? 0}
          sub={`sur ${totalF} référencé${totalF > 1 ? 's' : ''}`} tone="emerald" />
        <StatCard icon={Percent} label="Part de fournisseurs responsables"
          value={f.part_responsables_pct != null ? `${f.part_responsables_pct} %` : '—'}
          sub={f.part_responsables_pct != null ? 'en nombre de fournisseurs' : 'aucun fournisseur référencé'}
          tone={f.part_responsables_pct != null ? 'teal' : 'slate'} />
        <StatCard icon={FileWarning} label="FDS à traiter" value={fds.a_traiter ?? 0}
          sub={`sur ${fds.total ?? 0} fiche${(fds.total ?? 0) > 1 ? 's' : ''}`}
          tone={(fds.a_traiter ?? 0) > 0 ? 'red' : 'slate'} />
      </div>

      {/* Part d'achats responsables en montant */}
      <MontantBlock montant={dash.montant} />

      {/* Répartition : par statut + par famille */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800 mb-1">Fournisseurs par statut responsable</h3>
          <p className="text-xs text-slate-400 mb-3">Un fournisseur peut cumuler plusieurs statuts.</p>
          {totalF === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">Aucun fournisseur référencé.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={statutData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="statut" fontSize={12} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip formatter={(v) => [v, 'Fournisseurs']} />
                <Bar dataKey="count" name="Fournisseurs" radius={[4, 4, 0, 0]}>
                  {statutData.map((d) => <Cell key={d.key} fill={STATUT_COLORS[d.key] || '#10b981'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800 mb-1">Répartition par famille d'achat</h3>
          <p className="text-xs text-slate-400 mb-3">Total référencé et part responsable, par famille.</p>
          {familleData.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">Aucune famille à afficher.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={familleData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="famille" fontSize={12} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="total" name="Total" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="responsables" name="Responsables" fill="#059669" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* FDS à traiter */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center gap-2 mb-1">
          <FileWarning className="w-4 h-4 text-amber-600" />
          <h3 className="font-semibold text-slate-800">FDS à traiter</h3>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Produits dangereux dont la fiche de données de sécurité manque, n'a pas de date, ou est périmée
          (seuil de fraîcheur : {fds.fraicheur_jours ?? 365} jours).
        </p>
        {listeATraiter.length === 0 ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-3 py-2">
            Aucune FDS à traiter — le registre des produits dangereux déclarés est à jour.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 pr-2">Produit</th>
                  <th className="text-left py-2 px-2">Fournisseur</th>
                  <th className="text-left py-2 pl-2">Motif</th>
                </tr>
              </thead>
              <tbody>
                {listeATraiter.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50">
                    <td className="py-2 pr-2 font-medium text-slate-700">{d.produit}</td>
                    <td className="py-2 px-2 text-slate-600">{d.fournisseur_nom || <span className="text-slate-300">—</span>}</td>
                    <td className="py-2 pl-2">
                      <span className="inline-flex flex-wrap gap-1">
                        {String(d.motif || '').split(', ').filter(Boolean).map((mo, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{mo}</span>
                        ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rappel critères actifs */}
      <p className="text-xs text-slate-400">
        {criteres.total ?? 0} critère{(criteres.total ?? 0) > 1 ? 's' : ''} d'achat actif{(criteres.total ?? 0) > 1 ? 's' : ''} au référentiel.
      </p>
    </div>
  );
}
