import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, AlertCircle, CheckCircle2, Copy, Trash2 } from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader, LoadingSpinner } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

export default function AdminPermissions() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [modules, setModules] = useState([]);
  const [roles, setRoles] = useState([]); // [{ key, label, builtin, base_role }]
  const [access, setAccess] = useState({}); // access[roleKey][moduleKey] = bool (true = visible)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Duplication de rôle
  const [newLabel, setNewLabel] = useState('');
  const [sourceRole, setSourceRole] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const [cat, matrix] = await Promise.all([
        api.get('/permissions/catalog'),
        api.get('/permissions/matrix'),
      ]);
      const mods = cat.data.modules || [];
      const rls = cat.data.roles || [];
      setModules(mods);
      setRoles(rls);
      if (!sourceRole && rls.length) setSourceRole(rls[0].key);
      const a = {};
      for (const r of rls) { a[r.key] = {}; for (const m of mods) a[r.key][m.key] = true; }
      for (const row of (matrix.data || [])) {
        if (a[row.role] && row.module_key in a[row.role]) a[row.role][row.module_key] = row.allowed;
      }
      setAccess(a);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = (roleKey, moduleKey) => {
    setAccess((prev) => ({ ...prev, [roleKey]: { ...prev[roleKey], [moduleKey]: !prev[roleKey]?.[moduleKey] } }));
    setMsg('');
  };
  const setRoleAll = (roleKey, value) => {
    setAccess((prev) => {
      const next = { ...prev[roleKey] };
      for (const m of modules) next[m.key] = value;
      return { ...prev, [roleKey]: next };
    });
    setMsg('');
  };

  const save = async () => {
    setSaving(true); setError(''); setMsg('');
    try {
      const entries = [];
      for (const r of roles) for (const m of modules) entries.push({ role: r.key, module_key: m.key, allowed: !!access[r.key]?.[m.key] });
      await api.put('/permissions/matrix', { entries });
      setMsg('Habilitations enregistrées. Effet à la prochaine connexion (ou au rechargement) des utilisateurs concernés.');
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setSaving(false);
  };

  const createRole = async () => {
    if (!newLabel.trim() || !sourceRole) return;
    setCreating(true); setError(''); setMsg('');
    try {
      const r = await api.post('/permissions/roles', { label: newLabel.trim(), source_role: sourceRole });
      setNewLabel('');
      setMsg(`Rôle « ${r.data.label} » créé (dupliqué). Ajustez ses modules ci-dessous puis enregistrez.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setCreating(false);
  };

  const deleteRole = async (role) => {
    const ok = await confirm({
      title: `Supprimer le rôle « ${role.label} » ?`,
      message: "Les utilisateurs qui ont ce rôle seront réaffectés à son rôle de base. Cette action est irréversible.",
      confirmLabel: 'Supprimer', confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const r = await api.delete(`/permissions/roles/${role.key}`);
      setMsg(r.data.message || 'Rôle supprimé.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des habilitations..." /></Layout>;

  return (
    <Layout>
      {ConfirmDialogElement}
      <div className="p-6 space-y-4">
        <PageHeader
          title="Rôles & habilitations"
          subtitle="Créez des rôles et contrôlez quels modules chaque rôle voit"
          icon={ShieldCheck}
          actions={<button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Enregistrement…' : 'Enregistrer la matrice'}</button>}
        />

        {error && <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span></div>}
        {msg && <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm"><CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{msg}</span></div>}

        {/* Créer un rôle par duplication */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-slate-700 mb-1 flex items-center gap-2"><Copy className="w-4 h-4" /> Créer un rôle (duplication)</h3>
          <p className="text-xs text-slate-500 mb-3">
            Le nouveau rôle <strong>hérite des accès du rôle source</strong> (son modèle) puis se restreint via la matrice ci-dessous.
            Exemple : dupliquer « RH » pour créer « Opérations » ou « Logistique », puis cocher/décocher les modules voulus.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-slate-500">Nom du nouveau rôle</label>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ex : Opérations, Logistique…" className="input-modern mt-1" />
            </div>
            <div className="min-w-[180px]">
              <label className="text-xs text-slate-500">Dupliquer depuis</label>
              <select value={sourceRole} onChange={(e) => setSourceRole(e.target.value)} className="select-modern mt-1">
                {roles.map((r) => <option key={r.key} value={r.key}>{r.label}{r.builtin ? '' : ' (personnalisé)'}</option>)}
              </select>
            </div>
            <button onClick={createRole} disabled={creating || !newLabel.trim()} className="btn-primary text-sm h-[38px]">
              {creating ? 'Création…' : 'Créer le rôle'}
            </button>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 text-sm">
          <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p><strong>Décochez</strong> un module pour le <strong>masquer</strong> aux utilisateurs d'un rôle. L'<strong>Administrateur voit toujours tout</strong>.</p>
            <p className="text-sky-700 mt-0.5">Cocher ne donne jamais accès à un module que le rôle (ou son modèle) n'a pas — l'habilitation ne fait que <strong>restreindre</strong>.</p>
          </div>
        </div>

        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="p-3 text-left sticky left-0 bg-slate-50">Module</th>
                {roles.map((r) => (
                  <th key={r.key} className="p-3 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-1">
                      {r.label}
                      {!r.builtin && (
                        <button onClick={() => deleteRole(r)} title="Supprimer ce rôle" className="text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                    {!r.builtin && <div className="text-[9px] font-normal normal-case text-slate-400">≈ {r.base_role}</div>}
                    <div className="mt-1 flex justify-center gap-1 font-normal normal-case">
                      <button onClick={() => setRoleAll(r.key, true)} className="text-[10px] text-teal-600 hover:underline">tout</button>
                      <span className="text-slate-300">·</span>
                      <button onClick={() => setRoleAll(r.key, false)} className="text-[10px] text-red-500 hover:underline">rien</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="p-3 font-medium text-slate-700 sticky left-0 bg-white">{m.label}</td>
                  {roles.map((r) => {
                    const on = !!access[r.key]?.[m.key];
                    return (
                      <td key={r.key} className="p-3 text-center">
                        <button
                          onClick={() => toggle(r.key, m.key)}
                          aria-label={`${on ? 'Visible' : 'Masqué'} — ${r.label} / ${m.label}`}
                          className={`w-6 h-6 rounded border transition inline-flex items-center justify-center ${on ? 'bg-teal-500 border-teal-500 text-white' : 'bg-white border-slate-300 text-transparent hover:border-slate-400'}`}
                        >
                          {on && <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">Coche verte = module <strong>visible</strong>. Case vide = <strong>masqué</strong>. « ≈ » indique le rôle de base d'un rôle personnalisé.</p>
      </div>
    </Layout>
  );
}
