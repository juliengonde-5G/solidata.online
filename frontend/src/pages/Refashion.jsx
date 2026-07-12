import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, DataTable, StatusBadge, PageHeader } from '../components';
import { MapPin, Coins, Recycle, Wand2, Save, Plus, History, AlertTriangle } from 'lucide-react';
import api from '../services/api';

// Champs de tonnage de la déclaration DPAV (t)
const DPAV_TONNAGE_FIELDS = [
  { key: 'stock_debut_t', label: 'Stock début' },
  { key: 'stock_fin_t', label: 'Stock fin' },
  { key: 'achats_t', label: 'Entrées / achats matière', source: 'collecte_brut_t' },
  { key: 'tri_t', label: 'Entré en tri', source: 'tri_entree_t' },
  { key: 'ventes_reemploi_t', label: 'Réemploi (sortie)' },
  { key: 'ventes_recyclage_t', label: 'Recyclage (sortie)' },
  { key: 'csr_t', label: 'CSR (sortie)' },
  { key: 'energie_t', label: 'Valorisation énergie (sortie)' },
];

const emptyDpavForm = () => ({
  stock_debut_t: '', stock_fin_t: '', achats_t: '', tri_t: '',
  ventes_reemploi_t: '', ventes_recyclage_t: '', csr_t: '', energie_t: '',
  conformite_cdc: false, notes: '',
});

// Badge d'écart valeur saisie ↔ valeur calculée depuis l'activité ERP (item 27)
function EcartBadge({ saisi, calc }) {
  if (calc == null || calc === '' || isNaN(Number(calc))) return null;
  const s = Number(saisi) || 0;
  const c = Number(calc);
  const delta = s - c;
  if (Math.abs(delta) < 0.05) {
    return (
      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">
        = activité ({c.toFixed(3)} t)
      </span>
    );
  }
  const sign = delta > 0 ? '+' : '';
  return (
    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap"
      title={`Valeur calculée depuis l'activité : ${c.toFixed(3)} t`}>
      Δ {sign}{delta.toFixed(3)} t vs {c.toFixed(3)} t (activité)
    </span>
  );
}

export default function Refashion() {
  const [dpav, setDpav] = useState(null);
  const [dpavSource, setDpavSource] = useState(null); // ligne vw_refashion_dpav_source du trimestre
  const [communes, setCommunes] = useState([]);
  const [subventions, setSubventions] = useState([]);
  const [quarter, setQuarter] = useState(`${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('dpav');

  // Formulaires (item 28)
  const [dpavForm, setDpavForm] = useState(emptyDpavForm());
  const [showDpavForm, setShowDpavForm] = useState(false);
  const [savingDpav, setSavingDpav] = useState(false);

  const [communeForm, setCommuneForm] = useState({ commune: '', code_postal: '', poids_kg: '' });
  const [showCommuneForm, setShowCommuneForm] = useState(false);

  const [subForm, setSubForm] = useState(null);
  const [showSubForm, setShowSubForm] = useState(false);

  const [year, q] = [quarter.split('-Q')[0], quarter.split('-Q')[1]];

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dpavRes, srcRes, communesRes, subRes] = await Promise.all([
        api.get(`/refashion/dpav?year=${year}&quarter=${q}`),
        api.get(`/refashion/dpav-source?annee=${year}&trimestre=${q}`),
        api.get('/refashion/communes'),
        api.get('/refashion/subventions'),
      ]);
      setDpav(dpavRes.data);
      setDpavSource(Array.isArray(srcRes.data) ? (srcRes.data[0] || null) : null);
      setCommunes(communesRes.data);
      setSubventions(subRes.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [year, q]);

  useEffect(() => { loadData(); }, [loadData]);

  const currentYear = new Date().getFullYear();
  const quarters = [];
  for (let y = currentYear; y >= currentYear - 2; y--) {
    for (let qq = 4; qq >= 1; qq--) quarters.push(`${y}-Q${qq}`);
  }

  // ── Ouverture du formulaire DPAV pré-rempli depuis la déclaration existante ──
  const openDpavForm = () => {
    const raw = dpav?.raw || {};
    setDpavForm({
      stock_debut_t: raw.stock_debut_t ?? '',
      stock_fin_t: raw.stock_fin_t ?? '',
      achats_t: raw.achats_t ?? '',
      tri_t: raw.tri_t ?? '',
      ventes_reemploi_t: raw.ventes_reemploi_t ?? '',
      ventes_recyclage_t: raw.ventes_recyclage_t ?? '',
      csr_t: raw.csr_t ?? '',
      energie_t: raw.energie_t ?? '',
      conformite_cdc: !!raw.conformite_cdc,
      notes: raw.notes ?? '',
    });
    setShowDpavForm(true);
  };

  // ── Item 27 : pré-remplissage depuis l'activité ERP (collecte / tri) ──
  const prefillFromActivity = () => {
    if (!dpavSource) {
      setError("Aucune donnée d'activité (collecte / tri) disponible pour ce trimestre — la déclaration reste à saisir manuellement.");
      return;
    }
    setError(null);
    setDpavForm(f => ({
      ...f,
      achats_t: dpavSource.collecte_brut_t != null ? Number(dpavSource.collecte_brut_t).toFixed(3) : f.achats_t,
      tri_t: dpavSource.tri_entree_t != null ? Number(dpavSource.tri_entree_t).toFixed(3) : f.tri_t,
    }));
  };

  const saveDpav = async (e) => {
    e.preventDefault();
    setSavingDpav(true);
    setError(null);
    try {
      const num = (v) => (v === '' || v == null ? 0 : parseFloat(v));
      await api.post('/refashion/dpav', {
        annee: parseInt(year),
        trimestre: parseInt(q),
        stock_debut_t: num(dpavForm.stock_debut_t),
        stock_fin_t: num(dpavForm.stock_fin_t),
        achats_t: num(dpavForm.achats_t),
        ventes_reemploi_t: num(dpavForm.ventes_reemploi_t),
        ventes_recyclage_t: num(dpavForm.ventes_recyclage_t),
        csr_t: num(dpavForm.csr_t),
        energie_t: num(dpavForm.energie_t),
        tri_t: num(dpavForm.tri_t),
        conformite_cdc: !!dpavForm.conformite_cdc,
        notes: dpavForm.notes || null,
      });
      setShowDpavForm(false);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Échec de l\'enregistrement de la DPAV');
    } finally {
      setSavingDpav(false);
    }
  };

  const saveCommune = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/refashion/communes', {
        annee: parseInt(year),
        trimestre: parseInt(q),
        commune: communeForm.commune,
        code_postal: communeForm.code_postal || null,
        poids_kg: communeForm.poids_kg === '' ? 0 : parseFloat(communeForm.poids_kg),
      });
      setShowCommuneForm(false);
      setCommuneForm({ commune: '', code_postal: '', poids_kg: '' });
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Échec de l\'enregistrement de la commune');
    }
  };

  const openSubForm = () => {
    // Pré-remplit les tonnages depuis la DPAV du trimestre si disponible (réconcilie
    // les deux formules — cf. remarque auditeur Refashion sur DPAV vs subventions)
    const d = dpav || {};
    setSubForm({
      tonnage_reemploi: d.reemploi_t ?? '',
      tonnage_recyclage: d.recyclage_t ?? '',
      tonnage_csr: d.csr_t ?? '',
      tonnage_energie: d.energie_t ?? '',
      tonnage_entree: d.tri_t ?? '',
      part_non_tlc: '',
      taux_reemploi_euro_t: 80,
      taux_recyclage_euro_t: 295,
      taux_csr_euro_t: 210,
      taux_energie_euro_t: 20,
      taux_entree_euro_t: 193,
    });
    setShowSubForm(true);
  };

  const saveSubvention = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const num = (v) => (v === '' || v == null ? 0 : parseFloat(v));
      await api.post('/refashion/subventions', {
        annee: parseInt(year),
        trimestre: parseInt(q),
        tonnage_reemploi: num(subForm.tonnage_reemploi),
        tonnage_recyclage: num(subForm.tonnage_recyclage),
        tonnage_csr: num(subForm.tonnage_csr),
        tonnage_energie: num(subForm.tonnage_energie),
        tonnage_entree: num(subForm.tonnage_entree),
        part_non_tlc: num(subForm.part_non_tlc),
        taux_reemploi_euro_t: num(subForm.taux_reemploi_euro_t),
        taux_recyclage_euro_t: num(subForm.taux_recyclage_euro_t),
        taux_csr_euro_t: num(subForm.taux_csr_euro_t),
        taux_energie_euro_t: num(subForm.taux_energie_euro_t),
        taux_entree_euro_t: num(subForm.taux_entree_euro_t),
      });
      setShowSubForm(false);
      setSubForm(null);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Échec de l\'enregistrement de la subvention');
    }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  const inputCls = 'w-full px-3 py-2 border rounded-lg';
  const labelCls = 'text-xs font-semibold text-slate-600 block mb-1';

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Refashion"
          subtitle="DPAV trimestriel, communes et subventions"
          icon={Recycle}
          actions={
            <>
              <select value={quarter} onChange={e => setQuarter(e.target.value)} className="input-modern w-auto">
                {quarters.map(qq => <option key={qq} value={qq}>{qq}</option>)}
              </select>
              <button onClick={() => setView('dpav')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'dpav' ? 'bg-primary text-white' : 'bg-gray-100'}`}>DPAV</button>
              <button onClick={() => setView('communes')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'communes' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Communes</button>
              <button onClick={() => setView('subventions')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'subventions' ? 'bg-primary text-white' : 'bg-gray-100'}`}>Subventions</button>
            </>
          }
        />

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-lg mb-4 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}

        {view === 'dpav' && dpav && (
          <div className="space-y-6">
            {/* Bandeau activité ERP (item 27) */}
            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Activité ERP du trimestre — {quarter}</p>
                  {dpavSource ? (
                    <p className="text-xs text-slate-500 mt-1">
                      Collecte brute : <strong>{Number(dpavSource.collecte_brut_t).toFixed(3)} t</strong> ·
                      Entré en tri : <strong>{Number(dpavSource.tri_entree_t).toFixed(3)} t</strong> ·
                      Sortie tri : <strong>{Number(dpavSource.tri_sortie_t).toFixed(3)} t</strong>
                      {dpavSource.ecart_pct != null && (
                        <span className={`ml-2 px-2 py-0.5 rounded-full ${
                          dpavSource.ecart_severite === 'ok' ? 'bg-emerald-100 text-emerald-700'
                          : dpavSource.ecart_severite === 'attention' ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-700'}`}>
                          écart collecte/tri {dpavSource.ecart_pct}%
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 mt-1">Aucune donnée d'activité pour ce trimestre (collecte / production non saisies).</p>
                  )}
                </div>
                <button onClick={openDpavForm}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-semibold text-sm flex items-center gap-2">
                  <Save className="w-4 h-4" /> {dpav.raw && dpav.raw.id ? 'Modifier la déclaration' : 'Saisir la déclaration'}
                </button>
              </div>
            </div>

            {/* Summary Cards (tonnages saisis — sans taux €/t codés en dur, cf. audit) */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <DPAVCard label="Réemploi" value={dpav.reemploi_t} color="text-green-600" />
              <DPAVCard label="Recyclage" value={dpav.recyclage_t} color="text-blue-600" />
              <DPAVCard label="CSR" value={dpav.csr_t} color="text-orange-600" />
              <DPAVCard label="Énergie" value={dpav.energie_t} color="text-red-600" />
              <DPAVCard label="Entrées" value={dpav.entree_t} color="text-purple-600" />
              <DPAVCard label="Entré en tri" value={dpav.tri_t} color="text-slate-700" />
            </div>

            {/* Total */}
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm text-gray-500">Subvention estimée — {quarter}</p>
                  <p className="text-3xl font-bold text-primary">
                    {dpav.total_subvention != null
                      ? `${Number(dpav.total_subvention).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`
                      : 'En attente du taux'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {dpav.taux_entree_euro_par_tonne != null
                      ? `${Number(dpav.tri_t || 0).toFixed(3)} t entré en tri × ${dpav.taux_entree_euro_par_tonne} €/t`
                      : 'Aucun taux conventionné paramétré (voir Configuration Refashion).'}
                  </p>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <p>Nb de communes : {dpav.nb_communes || 0}</p>
                  {dpav.raw && dpav.raw.conformite_cdc && (
                    <StatusBadge status="active" size="sm" label="Conforme CDC" />
                  )}
                </div>
              </div>
            </div>

            {/* Journal des modifications (audit-trail / soumission tracée) */}
            {Array.isArray(dpav.history) && dpav.history.length > 0 && (
              <div className="card-modern p-4">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-2">
                  <History className="w-4 h-4" /> Journal de la déclaration
                </p>
                <ul className="text-xs text-slate-500 space-y-1">
                  {dpav.history.map((h, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded ${h.action === 'INSERT' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{h.action}</span>
                      <span>{new Date(h.changed_at).toLocaleString('fr-FR')}</span>
                      <span className="text-slate-400">— {h.changed_by_username || 'système'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── Formulaire DPAV (items 27 + 28) ── */}
        {view === 'dpav' && showDpavForm && (
          <form onSubmit={saveDpav} className="fixed inset-0 bg-black/40 flex items-start justify-center overflow-auto p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-3xl my-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800">Déclaration DPAV — {quarter}</h3>
                <button type="button" onClick={prefillFromActivity}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white font-semibold text-sm flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-40"
                  disabled={!dpavSource}
                  title={dpavSource ? '' : "Aucune activité disponible pour ce trimestre"}>
                  <Wand2 className="w-4 h-4" /> Pré-remplir depuis l'activité
                </button>
              </div>

              <p className="text-xs text-slate-500 mb-4">
                Le pré-remplissage renseigne les entrées (collecte) et le tonnage entré en tri depuis l'activité réelle.
                La ventilation des sorties (réemploi / recyclage / CSR / énergie) reste à saisir : elle n'est pas
                dérivable automatiquement (les sortants ne transitent pas tous par des produits finis catalogués).
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                {DPAV_TONNAGE_FIELDS.map(f => (
                  <div key={f.key}>
                    <label className={labelCls}>
                      {f.label} (t)
                      {f.source && <EcartBadge saisi={dpavForm[f.key]} calc={dpavSource ? dpavSource[f.source] : null} />}
                    </label>
                    <input type="number" step="0.001" value={dpavForm[f.key]}
                      onChange={e => setDpavForm({ ...dpavForm, [f.key]: e.target.value })}
                      className={inputCls} placeholder="0.000" />
                  </div>
                ))}
                <div className="md:col-span-2">
                  <label className={labelCls}>Notes</label>
                  <textarea value={dpavForm.notes} onChange={e => setDpavForm({ ...dpavForm, notes: e.target.value })}
                    className={inputCls} rows="2" />
                </div>
                <label className="md:col-span-2 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={dpavForm.conformite_cdc}
                    onChange={e => setDpavForm({ ...dpavForm, conformite_cdc: e.target.checked })} />
                  Déclaration validée conforme au cahier des charges Refashion (soumission)
                </label>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <button type="button" onClick={() => setShowDpavForm(false)}
                  className="px-5 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold">Annuler</button>
                <button type="submit" disabled={savingDpav}
                  className="px-5 py-2 rounded-lg bg-primary text-white font-bold disabled:opacity-50 flex items-center gap-2">
                  <Save className="w-4 h-4" /> {savingDpav ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </form>
        )}

        {view === 'communes' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              {!showCommuneForm && (
                <button onClick={() => setShowCommuneForm(true)}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-semibold text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Ajouter une commune desservie
                </button>
              )}
            </div>

            {showCommuneForm && (
              <form onSubmit={saveCommune} className="bg-white rounded-2xl shadow p-5 grid gap-4 md:grid-cols-4">
                <div className="md:col-span-2">
                  <label className={labelCls}>Commune ({quarter})</label>
                  <input required value={communeForm.commune}
                    onChange={e => setCommuneForm({ ...communeForm, commune: e.target.value })}
                    className={inputCls} placeholder="ex: Rouen" />
                </div>
                <div>
                  <label className={labelCls}>Code postal</label>
                  <input value={communeForm.code_postal}
                    onChange={e => setCommuneForm({ ...communeForm, code_postal: e.target.value })}
                    className={inputCls} placeholder="ex: 76000" />
                </div>
                <div>
                  <label className={labelCls}>Poids collecté (kg)</label>
                  <input type="number" step="0.01" value={communeForm.poids_kg}
                    onChange={e => setCommuneForm({ ...communeForm, poids_kg: e.target.value })}
                    className={inputCls} placeholder="0" />
                </div>
                <div className="md:col-span-4 flex gap-3 justify-end">
                  <button type="button" onClick={() => setShowCommuneForm(false)}
                    className="px-5 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold">Annuler</button>
                  <button type="submit" className="px-5 py-2 rounded-lg bg-primary text-white font-bold">Enregistrer</button>
                </div>
              </form>
            )}

            <DataTable
              columns={[
                { key: 'nom', label: 'Commune', sortable: true, render: (c) => <span className="font-medium">{c.nom}</span> },
                { key: 'code_insee', label: 'Code postal', render: (c) => <span className="text-gray-500">{c.code_insee}</span> },
                { key: 'poids_kg', label: 'Poids (kg)', sortable: true, render: (c) => (c.poids_kg != null ? Number(c.poids_kg).toLocaleString('fr-FR') : '—') },
                { key: 'nb_cav', label: 'Nb CAV', sortable: true, render: (c) => c.nb_cav || 0 },
                { key: 'has_convention', label: 'Convention', render: (c) => (
                  <StatusBadge status={c.has_convention ? 'active' : 'inactive'} size="sm" label={c.has_convention ? 'Active' : 'Non'} />
                )},
              ]}
              data={communes}
              loading={false}
              emptyIcon={MapPin}
              emptyMessage="Aucune commune"
            />
          </div>
        )}

        {view === 'subventions' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              {!showSubForm && (
                <button onClick={openSubForm}
                  className="px-4 py-2 rounded-lg bg-primary text-white font-semibold text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4" /> Saisir une subvention ({quarter})
                </button>
              )}
            </div>

            {showSubForm && subForm && (
              <form onSubmit={saveSubvention} className="bg-white rounded-2xl shadow p-5">
                <p className="text-xs text-slate-500 mb-4">
                  Les tonnages sont pré-remplis depuis la DPAV du trimestre (modifiables). Le montant est calculé
                  automatiquement (tonnage × taux €/t par famille).
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    ['tonnage_reemploi', 'Réemploi (t)', 'taux_reemploi_euro_t'],
                    ['tonnage_recyclage', 'Recyclage (t)', 'taux_recyclage_euro_t'],
                    ['tonnage_csr', 'CSR (t)', 'taux_csr_euro_t'],
                    ['tonnage_energie', 'Énergie (t)', 'taux_energie_euro_t'],
                    ['tonnage_entree', 'Entrée tri (t)', 'taux_entree_euro_t'],
                  ].map(([tKey, tLabel, tauxKey]) => (
                    <div key={tKey} className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={labelCls}>{tLabel}</label>
                        <input type="number" step="0.001" value={subForm[tKey]}
                          onChange={e => setSubForm({ ...subForm, [tKey]: e.target.value })}
                          className={inputCls} placeholder="0.000" />
                      </div>
                      <div>
                        <label className={labelCls}>Taux €/t</label>
                        <input type="number" step="0.01" value={subForm[tauxKey]}
                          onChange={e => setSubForm({ ...subForm, [tauxKey]: e.target.value })}
                          className={inputCls} />
                      </div>
                    </div>
                  ))}
                  <div>
                    <label className={labelCls}>Part non-TLC (%)</label>
                    <input type="number" step="0.01" value={subForm.part_non_tlc}
                      onChange={e => setSubForm({ ...subForm, part_non_tlc: e.target.value })}
                      className={inputCls} placeholder="0" />
                  </div>
                </div>
                <div className="flex gap-3 justify-end mt-6">
                  <button type="button" onClick={() => { setShowSubForm(false); setSubForm(null); }}
                    className="px-5 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold">Annuler</button>
                  <button type="submit" className="px-5 py-2 rounded-lg bg-primary text-white font-bold">Calculer & enregistrer</button>
                </div>
              </form>
            )}

            <DataTable
              columns={[
                { key: 'year', label: 'Année', sortable: true },
                { key: 'quarter', label: 'Trimestre', render: (s) => `Q${s.quarter}` },
                { key: 'montant', label: 'Montant (€)', sortable: true, render: (s) => <span className="font-medium text-primary">{parseFloat(s.montant || 0).toLocaleString('fr-FR')}€</span> },
                { key: 'status', label: 'Statut', render: (s) => (
                  <StatusBadge status={s.status} size="sm" label={s.status === 'paid' ? 'Versé' : undefined} />
                )},
                { key: 'date_versement', label: 'Date versement', render: (s) => <span className="text-gray-500">{s.date_versement ? new Date(s.date_versement).toLocaleDateString('fr-FR') : '—'}</span> },
              ]}
              data={subventions}
              loading={false}
              emptyIcon={Coins}
              emptyMessage="Aucune subvention"
            />
          </div>
        )}
      </div>
    </Layout>
  );
}

function DPAVCard({ label, value, color }) {
  return (
    <div className="card-modern p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{(value || 0).toFixed(2)}t</p>
    </div>
  );
}
