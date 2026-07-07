import { useState, useEffect } from 'react';
import { ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader, LoadingSpinner } from '../components';
import api from '../services/api';

const ROLE_LABELS = {
  MANAGER: 'Manager', RH: 'RH', COLLABORATEUR: 'Collaborateur',
  AUTORITE: 'Autorité', RESP_BTQ: 'Resp. Boutique',
};

export default function AdminPermissions() {
  const [modules, setModules] = useState([]);
  const [roles, setRoles] = useState([]);
  const [access, setAccess] = useState({}); // access[role][moduleKey] = bool (true = autorisé/visible)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [cat, matrix] = await Promise.all([
          api.get('/permissions/catalog'),
          api.get('/permissions/matrix'),
        ]);
        const mods = cat.data.modules || [];
        const rls = cat.data.roles || [];
        setModules(mods);
        setRoles(rls);
        // Par défaut tout est autorisé ; on applique ensuite les refus enregistrés.
        const a = {};
        for (const r of rls) { a[r] = {}; for (const m of mods) a[r][m.key] = true; }
        for (const row of (matrix.data || [])) {
          if (a[row.role] && row.module_key in a[row.role]) a[row.role][row.module_key] = row.allowed;
        }
        setAccess(a);
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      }
      setLoading(false);
    })();
  }, []);

  const toggle = (role, key) => {
    setAccess((prev) => ({ ...prev, [role]: { ...prev[role], [key]: !prev[role]?.[key] } }));
    setMsg('');
  };

  const setRoleAll = (role, value) => {
    setAccess((prev) => {
      const next = { ...prev[role] };
      for (const m of modules) next[m.key] = value;
      return { ...prev, [role]: next };
    });
    setMsg('');
  };

  const save = async () => {
    setSaving(true); setError(''); setMsg('');
    try {
      const entries = [];
      for (const r of roles) for (const m of modules) entries.push({ role: r, module_key: m.key, allowed: !!access[r]?.[m.key] });
      await api.put('/permissions/matrix', { entries });
      setMsg("Habilitations enregistrées. Les utilisateurs concernés verront le changement à leur prochaine connexion ou au rechargement de la page.");
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setSaving(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des habilitations..." /></Layout>;

  return (
    <Layout>
      <div className="p-6 space-y-4">
        <PageHeader
          title="Habilitations par module"
          subtitle="Contrôlez quels modules chaque rôle voit dans le menu"
          icon={ShieldCheck}
          actions={
            <button onClick={save} disabled={saving} className="btn-primary text-sm">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          }
        />

        <div className="flex items-start gap-3 p-4 rounded-lg bg-sky-50 border border-sky-200 text-sky-800 text-sm">
          <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p><strong>Décochez</strong> un module pour le <strong>masquer</strong> aux utilisateurs d'un rôle (exemple : un Manager focalisé RH n'a pas besoin de voir « Tri »).</p>
            <p className="text-sky-700 mt-0.5">L'<strong>Administrateur voit toujours tout</strong>. Cocher une case ne donne jamais accès à un module que le rôle n'a pas par défaut — l'habilitation ne fait que <strong>restreindre</strong>.</p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span>
          </div>
        )}
        {msg && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{msg}</span>
          </div>
        )}

        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <th className="p-3 text-left sticky left-0 bg-slate-50">Module</th>
                {roles.map((r) => (
                  <th key={r} className="p-3 text-center whitespace-nowrap">
                    {ROLE_LABELS[r] || r}
                    <div className="mt-1 flex justify-center gap-1 font-normal normal-case">
                      <button onClick={() => setRoleAll(r, true)} className="text-[10px] text-teal-600 hover:underline">tout</button>
                      <span className="text-slate-300">·</span>
                      <button onClick={() => setRoleAll(r, false)} className="text-[10px] text-red-500 hover:underline">rien</button>
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
                    const on = !!access[r]?.[m.key];
                    return (
                      <td key={r} className="p-3 text-center">
                        <button
                          onClick={() => toggle(r, m.key)}
                          aria-label={`${on ? 'Autorisé' : 'Masqué'} — ${ROLE_LABELS[r] || r} / ${m.label}`}
                          className={`w-6 h-6 rounded border transition inline-flex items-center justify-center ${
                            on ? 'bg-teal-500 border-teal-500 text-white' : 'bg-white border-slate-300 text-transparent hover:border-slate-400'
                          }`}
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

        <p className="text-xs text-slate-400">
          Coche verte = module <strong>visible</strong> pour ce rôle. Case vide = <strong>masqué</strong>.
        </p>
      </div>
    </Layout>
  );
}
