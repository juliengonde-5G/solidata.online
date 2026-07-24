import { useState, useEffect, useCallback } from 'react';
import { Building2, Gauge, Plus, Pencil, Trash2, Sliders, Info } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, EmptyState, Modal, useToast, ConfirmDialog } from '../index';
import { TYPES_COMPTEUR, posteLabel, num, fmtNum, apiErr } from './energieShared';

// Postes reconnus par le moteur GES (doivent matcher compteur.type / carburant).
const POSTES_GES = ['electricite', 'gaz', 'eau', 'autre', 'gazole', 'essence', 'gnv', 'electrique', 'adblue'];
const UNITE_SUGGESTIONS = ['kWh', 'm3', 'L', 'kg'];

// ── Modale Site ───────────────────────────────────────────────────────────────
function SiteForm({ open, onClose, onSaved, editing }) {
  const toast = useToast();
  const [form, setForm] = useState({ nom: '', adresse: '', actif: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return;
    setForm(editing ? { nom: editing.nom || '', adresse: editing.adresse || '', actif: editing.actif !== false } : { nom: '', adresse: '', actif: true });
    setError(null);
  }, [open, editing]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.nom.trim()) { setError('Le nom du site est requis.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = { nom: form.nom.trim(), adresse: form.adresse.trim() || null, actif: form.actif };
      if (editing) await api.put(`/energie/sites/${editing.id}`, payload);
      else await api.post('/energie/sites', payload);
      toast.success(editing ? 'Site modifié.' : 'Site créé.');
      onSaved();
    } catch (err) { setError(apiErr(err)); setSaving(false); }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={editing ? 'Modifier le site' : 'Nouveau site'} size="md"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuler</button>
        <button type="submit" form="site-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>}>
      <form id="site-form" onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Nom du site</label>
          <input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} className="input-modern py-2 text-sm w-full" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Adresse</label>
          <input value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} className="input-modern py-2 text-sm w-full" placeholder="optionnel" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded border-slate-300" /> Site actif
        </label>
      </form>
    </Modal>
  );
}

// ── Modale Compteur ───────────────────────────────────────────────────────────
function CompteurForm({ open, onClose, onSaved, editing, sites }) {
  const toast = useToast();
  const [form, setForm] = useState({ site_id: '', type: 'electricite', reference: '', unite: 'kWh', actif: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({ site_id: String(editing.site_id || ''), type: editing.type || 'electricite', reference: editing.reference || '', unite: editing.unite || 'kWh', actif: editing.actif !== false });
    } else {
      setForm({ site_id: sites[0] ? String(sites[0].id) : '', type: 'electricite', reference: '', unite: 'kWh', actif: true });
    }
    setError(null);
  }, [open, editing, sites]);

  const changeType = (type) => {
    const t = TYPES_COMPTEUR.find((x) => x.value === type);
    setForm((f) => ({ ...f, type, unite: t ? t.unite : f.unite }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.site_id) { setError('Le site est requis.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = { site_id: parseInt(form.site_id, 10), type: form.type, reference: form.reference.trim() || null, unite: form.unite.trim() || 'kWh', actif: form.actif };
      if (editing) await api.put(`/energie/compteurs/${editing.id}`, payload);
      else await api.post('/energie/compteurs', payload);
      toast.success(editing ? 'Compteur modifié.' : 'Compteur créé.');
      onSaved();
    } catch (err) { setError(apiErr(err)); setSaving(false); }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={editing ? 'Modifier le compteur' : 'Nouveau compteur'} size="md"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuler</button>
        <button type="submit" form="compteur-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>}>
      <form id="compteur-form" onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Site</label>
          <select value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })} className="input-modern py-2 text-sm w-full" required>
            <option value="">— Choisir un site —</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
            <select value={form.type} onChange={(e) => changeType(e.target.value)} className="input-modern py-2 text-sm w-full">
              {TYPES_COMPTEUR.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Unité</label>
            <input list="compteur-unites" value={form.unite} onChange={(e) => setForm({ ...form, unite: e.target.value })} className="input-modern py-2 text-sm w-full" />
            <datalist id="compteur-unites">{UNITE_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Référence (PDL, n° compteur…)</label>
          <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="input-modern py-2 text-sm w-full" placeholder="optionnel" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded border-slate-300" /> Compteur actif
        </label>
      </form>
    </Modal>
  );
}

// ── Modale Facteur d'émission ─────────────────────────────────────────────────
function FacteurForm({ open, onClose, onSaved, editing }) {
  const toast = useToast();
  const [form, setForm] = useState({ poste: 'electricite', unite: 'kWh', facteur_kgco2e: '', source: 'ADEME Base Empreinte', annee: '', actif: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return;
    setForm(editing ? {
      poste: editing.poste || 'electricite', unite: editing.unite || 'kWh',
      facteur_kgco2e: editing.facteur_kgco2e != null ? String(editing.facteur_kgco2e) : '',
      source: editing.source || 'ADEME Base Empreinte', annee: editing.annee != null ? String(editing.annee) : '', actif: editing.actif !== false,
    } : { poste: 'electricite', unite: 'kWh', facteur_kgco2e: '', source: 'ADEME Base Empreinte', annee: String(new Date().getFullYear()), actif: true });
    setError(null);
  }, [open, editing]);

  const submit = async (e) => {
    e.preventDefault();
    const fac = num(form.facteur_kgco2e);
    if (fac == null || fac < 0) { setError('Le facteur (kgCO2e/unité) est requis.'); return; }
    if (!form.unite.trim()) { setError('L\'unité est requise.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        poste: form.poste, unite: form.unite.trim(), facteur_kgco2e: fac,
        source: form.source.trim() || 'ADEME Base Empreinte',
        annee: form.annee === '' ? null : parseInt(form.annee, 10), actif: form.actif,
      };
      if (editing) await api.put(`/energie/facteurs/${editing.id}`, payload);
      else await api.post('/energie/facteurs', payload);
      toast.success(editing ? 'Facteur modifié.' : 'Facteur créé.');
      onSaved();
    } catch (err) { setError(apiErr(err)); setSaving(false); }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={editing ? 'Modifier le facteur d\'émission' : 'Nouveau facteur d\'émission'} size="md"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuler</button>
        <button type="submit" form="facteur-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>}>
      <form id="facteur-form" onSubmit={submit} className="space-y-3">
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>Valeurs <strong>indicatives à ajuster</strong> avec les facteurs ADEME Base Empreinte millésimés de la structure. Elles ne prétendent pas à l'exactitude réglementaire.</span>
        </div>
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Poste</label>
            <select value={form.poste} onChange={(e) => setForm({ ...form, poste: e.target.value })} className="input-modern py-2 text-sm w-full">
              {POSTES_GES.map((p) => <option key={p} value={p}>{posteLabel(p)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Unité</label>
            <input list="facteur-unites" value={form.unite} onChange={(e) => setForm({ ...form, unite: e.target.value })} className="input-modern py-2 text-sm w-full" required />
            <datalist id="facteur-unites">{UNITE_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Facteur (kgCO2e / unité)</label>
            <input type="number" min="0" step="0.00001" value={form.facteur_kgco2e} onChange={(e) => setForm({ ...form, facteur_kgco2e: e.target.value })} className="input-modern py-2 text-sm w-full" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Année (millésime)</label>
            <input type="number" min="2000" max="2100" step="1" value={form.annee} onChange={(e) => setForm({ ...form, annee: e.target.value })} placeholder="toutes années" className="input-modern py-2 text-sm w-full" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
          <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="input-modern py-2 text-sm w-full" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded border-slate-300" /> Facteur actif
        </label>
      </form>
    </Modal>
  );
}

// ── Onglet Réglages ───────────────────────────────────────────────────────────
export default function AdminCompteurs({ canWrite, canWriteFacteurs }) {
  const toast = useToast();
  const [sites, setSites] = useState([]);
  const [compteurs, setCompteurs] = useState([]);
  const [facteurs, setFacteurs] = useState([]);
  const [avert, setAvert] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [siteModal, setSiteModal] = useState({ open: false, editing: null });
  const [compteurModal, setCompteurModal] = useState({ open: false, editing: null });
  const [facteurModal, setFacteurModal] = useState({ open: false, editing: null });
  const [confirm, setConfirm] = useState(null); // { kind, item }

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.get('/energie/sites'), api.get('/energie/compteurs'), api.get('/energie/facteurs')])
      .then(([s, c, f]) => {
        setSites(Array.isArray(s.data) ? s.data : []);
        setCompteurs(Array.isArray(c.data) ? c.data : []);
        setFacteurs(Array.isArray(f.data?.facteurs) ? f.data.facteurs : []);
        setAvert(f.data?.avertissement || '');
        setError(null);
      })
      .catch((err) => setError(apiErr(err)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const doDelete = async () => {
    if (!confirm) return;
    const { kind, item } = confirm;
    try {
      await api.delete(`/energie/${kind}/${item.id}`);
      toast.success('Suppression effectuée.');
      setConfirm(null);
      load();
    } catch (err) { toast.error(apiErr(err, 'Suppression impossible.')); }
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement des réglages…" />;
  if (error) return <ErrorState variant="card" title="Réglages indisponibles" message={error} onRetry={load} />;

  const compteursBySite = compteurs.reduce((acc, c) => { (acc[c.site_id] = acc[c.site_id] || []).push(c); return acc; }, {});

  return (
    <div className="space-y-6">
      {/* Sites */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Building2 className="w-4 h-4 text-teal-600" /> Sites</h3>
          {canWrite && <button onClick={() => setSiteModal({ open: true, editing: null })} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nouveau site</button>}
        </div>
        {sites.length === 0 ? (
          <EmptyState icon={Building2} title="Aucun site" description="Créez un site (siège, dépôt…) pour y rattacher des compteurs." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr><th className="text-left py-2 px-2">Site</th><th className="text-left py-2 px-2">Adresse</th><th className="text-right py-2 px-2">Compteurs</th><th className="text-center py-2 px-2">Actif</th>{canWrite && <th className="text-right py-2 px-2">Actions</th>}</tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className="border-b border-slate-50">
                    <td className="py-2 px-2 font-medium text-slate-700">{s.nom}</td>
                    <td className="py-2 px-2 text-slate-500">{s.adresse || '—'}</td>
                    <td className="py-2 px-2 text-right text-slate-600">{s.nb_compteurs ?? 0}</td>
                    <td className="py-2 px-2 text-center">{s.actif !== false ? <span className="text-emerald-600">Oui</span> : <span className="text-slate-400">Non</span>}</td>
                    {canWrite && (
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        <button onClick={() => setSiteModal({ open: true, editing: s })} className="text-slate-400 hover:text-teal-700 p-1" title="Modifier" aria-label="Modifier"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setConfirm({ kind: 'sites', item: s })} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Compteurs */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Gauge className="w-4 h-4 text-teal-600" /> Compteurs</h3>
          {canWrite && <button onClick={() => setCompteurModal({ open: true, editing: null })} disabled={sites.length === 0} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"><Plus className="w-4 h-4" /> Nouveau compteur</button>}
        </div>
        {compteurs.length === 0 ? (
          <EmptyState icon={Gauge} title="Aucun compteur" description={sites.length === 0 ? 'Créez d\'abord un site.' : 'Ajoutez les compteurs (électricité, gaz, eau) de vos sites.'} />
        ) : (
          <div className="space-y-4">
            {sites.filter((s) => compteursBySite[s.id]?.length).map((s) => (
              <div key={s.id}>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{s.nom}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                      <tr><th className="text-left py-2 px-2">Type</th><th className="text-left py-2 px-2">Référence</th><th className="text-left py-2 px-2">Unité</th><th className="text-center py-2 px-2">Actif</th>{canWrite && <th className="text-right py-2 px-2">Actions</th>}</tr>
                    </thead>
                    <tbody>
                      {compteursBySite[s.id].map((c) => (
                        <tr key={c.id} className="border-b border-slate-50">
                          <td className="py-2 px-2 font-medium text-slate-700">{posteLabel(c.type)}</td>
                          <td className="py-2 px-2 text-slate-500">{c.reference || '—'}</td>
                          <td className="py-2 px-2 text-slate-600">{c.unite}</td>
                          <td className="py-2 px-2 text-center">{c.actif !== false ? <span className="text-emerald-600">Oui</span> : <span className="text-slate-400">Non</span>}</td>
                          {canWrite && (
                            <td className="py-2 px-2 text-right whitespace-nowrap">
                              <button onClick={() => setCompteurModal({ open: true, editing: c })} className="text-slate-400 hover:text-teal-700 p-1" title="Modifier" aria-label="Modifier"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => setConfirm({ kind: 'compteurs', item: c })} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer"><Trash2 className="w-4 h-4" /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Facteurs d'émission */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Sliders className="w-4 h-4 text-teal-600" /> Facteurs d'émission GES</h3>
          {canWriteFacteurs && <button onClick={() => setFacteurModal({ open: true, editing: null })} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nouveau facteur</button>}
        </div>
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3">{avert || 'Facteurs indicatifs et paramétrables — valeurs à ajuster avec les facteurs ADEME Base Empreinte millésimés de la structure.'}</div>
        {!canWriteFacteurs && <p className="text-xs text-slate-400 mb-2">Édition des facteurs réservée aux rôles ADMIN / RH.</p>}
        {facteurs.length === 0 ? (
          <EmptyState icon={Sliders} title="Aucun facteur" description="Ajoutez les facteurs d'émission (kgCO2e par unité) par poste." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr><th className="text-left py-2 px-2">Poste</th><th className="text-right py-2 px-2">Facteur</th><th className="text-left py-2 px-2">Unité</th><th className="text-left py-2 px-2">Source</th><th className="text-center py-2 px-2">Année</th><th className="text-center py-2 px-2">Actif</th>{canWriteFacteurs && <th className="text-right py-2 px-2">Actions</th>}</tr>
              </thead>
              <tbody>
                {facteurs.map((f) => (
                  <tr key={f.id} className="border-b border-slate-50">
                    <td className="py-2 px-2 font-medium text-slate-700">{posteLabel(f.poste)}</td>
                    <td className="py-2 px-2 text-right text-slate-700">{fmtNum(f.facteur_kgco2e, 5)} <span className="text-slate-400 text-xs">kgCO2e</span></td>
                    <td className="py-2 px-2 text-slate-600">/ {f.unite}</td>
                    <td className="py-2 px-2 text-slate-500 max-w-[220px] truncate" title={f.source}>{f.source}</td>
                    <td className="py-2 px-2 text-center text-slate-600">{f.annee ?? 'toutes'}</td>
                    <td className="py-2 px-2 text-center">{f.actif !== false ? <span className="text-emerald-600">Oui</span> : <span className="text-slate-400">Non</span>}</td>
                    {canWriteFacteurs && (
                      <td className="py-2 px-2 text-right">
                        <button onClick={() => setFacteurModal({ open: true, editing: f })} className="text-slate-400 hover:text-teal-700 p-1" title="Modifier" aria-label="Modifier"><Pencil className="w-4 h-4" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SiteForm open={siteModal.open} editing={siteModal.editing} onClose={() => setSiteModal({ open: false, editing: null })} onSaved={() => { setSiteModal({ open: false, editing: null }); load(); }} />
      <CompteurForm open={compteurModal.open} editing={compteurModal.editing} sites={sites} onClose={() => setCompteurModal({ open: false, editing: null })} onSaved={() => { setCompteurModal({ open: false, editing: null }); load(); }} />
      <FacteurForm open={facteurModal.open} editing={facteurModal.editing} onClose={() => setFacteurModal({ open: false, editing: null })} onSaved={() => { setFacteurModal({ open: false, editing: null }); load(); }} />

      <ConfirmDialog isOpen={!!confirm} onCancel={() => setConfirm(null)} onConfirm={doDelete}
        title="Confirmer la suppression"
        message={confirm ? (confirm.kind === 'sites'
          ? `Supprimer le site « ${confirm.item.nom} » ? Ses compteurs et relevés seront aussi supprimés (cascade). Action définitive.`
          : `Supprimer ce compteur « ${posteLabel(confirm.item.type)} » ? Ses relevés seront aussi supprimés (cascade). Action définitive.`) : ''}
        confirmLabel="Supprimer" confirmVariant="danger" />
    </div>
  );
}
