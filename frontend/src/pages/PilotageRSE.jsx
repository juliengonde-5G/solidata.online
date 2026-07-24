import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, ErrorState } from '../components';
import {
  Leaf, LayoutDashboard, ListChecks, Paperclip, ClipboardList, Users, FileText,
  Target, CheckCircle2, AlertTriangle, FileDown, RefreshCw,
} from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useAssignableUsers, apiErr } from '../components/rse/rseShared';
import HeatmapCriteres from '../components/rse/HeatmapCriteres';
import CotationCritere from '../components/rse/CotationCritere';
import ActionsRSE from '../components/rse/ActionsRSE';
import RegistrePreuves from '../components/rse/RegistrePreuves';
import EvaluationsRSE from '../components/rse/EvaluationsRSE';
import PartiesPrenantes from '../components/rse/PartiesPrenantes';
import { printBilanRse, printDossierAfnor } from '../components/rse/pdf-rse';

const TABS = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { id: 'actions', label: "Plan d'action", icon: ListChecks },
  { id: 'preuves', label: 'Registre de preuves', icon: Paperclip },
  { id: 'evaluations', label: 'Évaluations', icon: ClipboardList },
  { id: 'pp', label: 'Parties prenantes', icon: Users },
  { id: 'documents', label: 'Documents', icon: FileText },
];

function StatCard({ icon: Icon, label, value, sub, tone = 'emerald' }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    teal: 'bg-teal-50 text-teal-700 border-teal-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.emerald}`}>
      <div className="flex items-center gap-2 text-xs font-medium opacity-80">{Icon && <Icon className="w-4 h-4" />}{label}</div>
      <div className="mt-1 text-2xl font-bold">{value ?? '—'}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Onglet Tableau de bord ────────────────────────────────────────────────────
function DashboardTab({ dashboard, onSelectCritere, onReload }) {
  const g = dashboard?.global || {};
  const act = g.actions || {};
  const pr = g.preuves || {};
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Target} label="Critères cotés" value={`${g.criteres_cotes ?? 0}/${g.total_criteres ?? 27}`}
          sub="auto-évaluation renseignée" tone="teal" />
        <StatCard icon={CheckCircle2} label="Couverture niveau 2" value={`${g.couverture_niveau2_pct ?? 0} %`}
          sub={`${g.criteres_niveau2_demontrable ?? 0}/${g.total_criteres ?? 27} démontrables (preuve fraîche)`} tone="emerald" />
        <StatCard icon={ListChecks} label="Actions soldées à l'échéance"
          value={act.taux_solde_echeance != null ? `${act.taux_solde_echeance} %` : 'n/a'}
          sub={`${act.echues_realisees ?? 0}/${act.echues ?? 0} échues réalisées`}
          tone={act.taux_solde_echeance != null && act.taux_solde_echeance < 80 ? 'amber' : 'slate'} />
        <StatCard icon={AlertTriangle} label="Preuves périmées" value={pr.perimees ?? 0}
          sub={`sur ${pr.total ?? 0} preuve(s)`} tone={(pr.perimees ?? 0) > 0 ? 'red' : 'slate'} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Critères sans preuve récente" value={g.criteres_sans_preuve_recente ?? 0}
          sub="preuve < 12 mois manquante" tone={(g.criteres_sans_preuve_recente ?? 0) > 0 ? 'amber' : 'slate'} />
        <StatCard label="Actions du plan" value={act.total ?? 0} sub={`${act.realisees ?? 0} réalisées`} tone="slate" />
        <StatCard label="Actions en retard" value={act.en_retard ?? 0} tone={(act.en_retard ?? 0) > 0 ? 'red' : 'slate'} />
        <StatCard label="Preuves au registre" value={pr.total ?? 0} tone="slate" />
      </div>

      {g.criteres_cotes === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          Aucun critère coté pour l'instant — commencez l'auto-évaluation en cliquant sur un critère de la carte ci-dessous.
        </div>
      )}

      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="text-lg font-semibold text-slate-800">Cartographie des 27 critères</h2>
          <button onClick={onReload} className="text-xs text-slate-400 hover:text-emerald-700 inline-flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Actualiser
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-3">Cliquez un critère pour coter son niveau visé / auto-évalué, désigner son pilote et commenter.</p>
        <HeatmapCriteres criteres={dashboard?.criteres || []} onSelect={onSelectCritere} />
      </div>
    </div>
  );
}

// ── Onglet Documents ──────────────────────────────────────────────────────────
function DocumentsTab() {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const years = [];
  for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 5; y--) years.push(y);

  const genBilan = async () => {
    setBusy('bilan'); setError(null);
    try {
      const r = await api.get(`/rse/bilan?annee=${annee}`);
      printBilanRse(r.data);
    } catch (err) { setError(apiErr(err, 'Échec de la génération du bilan.')); }
    setBusy(null);
  };
  const genDossier = async () => {
    setBusy('dossier'); setError(null);
    try {
      const r = await api.get('/rse/dossier-afnor');
      printDossierAfnor(r.data);
    } catch (err) { setError(apiErr(err, 'Échec de la génération du dossier.')); }
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-800">Génération de documents</h2>
      {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-5 flex flex-col">
          <div className="flex items-center gap-2 text-slate-800 font-semibold"><FileText className="w-5 h-5 text-emerald-600" /> Bilan RSE annuel</div>
          <p className="text-sm text-slate-500 mt-1 flex-1">
            Synthèse de l'exercice : état du plan d'action, répartition des niveaux de maturité, preuves, dernière évaluation interne. Mise en page A4 (bilan 5.4).
          </p>
          <div className="flex items-center gap-2 mt-3">
            <label className="text-sm text-slate-500" htmlFor="doc-year">Année</label>
            <select id="doc-year" value={annee} onChange={(e) => setAnnee(Number(e.target.value))} className="input-modern py-1.5 text-sm w-auto">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={genBilan} disabled={busy === 'bilan'} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50 ml-auto">
              <FileDown className="w-4 h-4" /> {busy === 'bilan' ? 'Génération…' : 'Générer le PDF'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5 flex flex-col">
          <div className="flex items-center gap-2 text-slate-800 font-semibold"><ClipboardList className="w-5 h-5 text-emerald-600" /> Dossier de préparation AFNOR</div>
          <p className="text-sm text-slate-500 mt-1 flex-1">
            Par critère : niveau visé / auto-évalué, pilote, preuves rattachées, dernier constat et commentaire. Support de la phase 1 de l'évaluation.
          </p>
          <div className="flex items-center mt-3">
            <button onClick={genDossier} disabled={busy === 'dossier'} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50 ml-auto">
              <FileDown className="w-4 h-4" /> {busy === 'dossier' ? 'Génération…' : 'Générer le PDF'}
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Rappel : la communication externe sur le label RSEi n'est autorisée qu'à partir du niveau 2 « Engagé ». Ces documents sont à usage interne / préparation d'évaluation.
      </p>
    </div>
  );
}

export default function PilotageRSE() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const canWrite = ['ADMIN', 'RH', 'MANAGER'].includes(base);

  const [tab, setTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [criteres, setCriteres] = useState([]); // liste complète (avec commentaire) pour cotation + multi-select
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cotation, setCotation] = useState(null); // code du critère en cours de cotation
  const { users, restricted } = useAssignableUsers();

  const loadCore = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/rse/dashboard'),
      api.get('/rse/criteres'),
    ])
      .then(([d, c]) => {
        setDashboard(d.data);
        setCriteres(Array.isArray(c.data) ? c.data : []);
        setError(null);
      })
      .catch((err) => setError(apiErr(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadCore(); }, [loadCore]);

  const critereForCotation = cotation ? (criteres.find((c) => c.code === cotation) || null) : null;

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <PageHeader
          title="Pilotage RSE"
          subtitle="Démarche de labellisation RSEi — 27 critères, plan d'action, preuves, évaluations"
          icon={Leaf}
        />

        {/* Onglets */}
        <div className="border-b border-slate-200 mb-5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${active ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  aria-current={active ? 'page' : undefined}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <LoadingSpinner size="lg" message="Chargement du pilotage RSE…" />
        ) : error ? (
          <ErrorState variant="card" title="Impossible de charger le module" message={error} onRetry={loadCore} />
        ) : (
          <>
            {tab === 'dashboard' && (
              <DashboardTab dashboard={dashboard} onSelectCritere={setCotation} onReload={loadCore} />
            )}
            {tab === 'actions' && (
              <ActionsRSE criteres={criteres} users={users} restricted={restricted} canWrite={canWrite} />
            )}
            {tab === 'preuves' && (
              <RegistrePreuves criteres={criteres} canWrite={canWrite} />
            )}
            {tab === 'evaluations' && (
              <EvaluationsRSE criteres={criteres} users={users} restricted={restricted} canWrite={canWrite} />
            )}
            {tab === 'pp' && (
              <PartiesPrenantes canWrite={canWrite} />
            )}
            {tab === 'documents' && (
              <DocumentsTab />
            )}
          </>
        )}

        {critereForCotation && (
          <CotationCritere
            critere={critereForCotation}
            users={users}
            restricted={restricted}
            canWrite={canWrite}
            onClose={() => setCotation(null)}
            onSaved={() => { setCotation(null); loadCore(); }}
          />
        )}
      </div>
    </Layout>
  );
}
