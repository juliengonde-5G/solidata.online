import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, AlertCircle, CheckCircle2, Copy, Trash2, Plus, Minus, X, Lock } from 'lucide-react';
import Layout from '../components/Layout';
import { PageHeader, LoadingSpinner } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

// ── Les trois états d'une case ────────────────────────────────────────────
//
// Jusqu'en 2.56.0 la matrice était binaire et ne savait que RETIRER. Le retrait
// des profils MANAGER/QHSE/FINANCE a resserré la barre latérale sur le seul
// ADMIN : plus aucun profil ne pouvait recevoir la Collecte, le Tri, l'Analyse
// ou la Frip sans qu'on lui donne ADMIN — donc aussi les comptes utilisateurs,
// la base de données et le registre RGPD. D'où un troisième état, « Accordé ».
const ETATS = {
  denied: {
    cle: 'denied',
    libelle: 'Refusé',
    aide: 'Le module est retiré à ce rôle, même si son rôle le lui ouvrait.',
    classe: 'bg-red-500 border-red-500 text-white',
    Icone: X,
  },
  default: {
    cle: 'default',
    libelle: 'Par défaut',
    aide: "Le rôle décide seul : ce qu'il ouvre habituellement, ni plus ni moins.",
    classe: 'bg-white border-slate-300 text-slate-300 hover:border-slate-400',
    Icone: Minus,
  },
  granted: {
    cle: 'granted',
    libelle: 'Accordé',
    aide: "Le module est AJOUTÉ à ce rôle — écrans et API. À n'accorder qu'en connaissance de cause.",
    classe: 'bg-teal-500 border-teal-500 text-white',
    Icone: Plus,
  },
};

// Le clic fait défiler les états. « Par défaut » d'abord : c'est l'état de
// repos, celui qu'on veut retrouver le plus facilement après une erreur.
const CYCLE = ['default', 'granted', 'denied'];
const CYCLE_SANS_ACCORD = ['default', 'denied'];

export default function AdminPermissions() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [modules, setModules] = useState([]);
  const [roles, setRoles] = useState([]); // [{ key, label, builtin, base_role }]
  const [access, setAccess] = useState({}); // access[roleKey][moduleKey] = 'denied' | 'default' | 'granted'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [avertissement, setAvertissement] = useState('');
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
      for (const r of rls) { a[r.key] = {}; for (const m of mods) a[r.key][m.key] = 'default'; }
      for (const row of (matrix.data || [])) {
        if (a[row.role] && row.module_key in a[row.role]) {
          // Le REFUS prime : une ligne qui porterait les deux (impossible à
          // écrire par cet écran, mais lisible d'une base retouchée à la main)
          // se lit comme un refus, jamais comme un accord.
          a[row.role][row.module_key] =
            row.allowed === false ? 'denied' : (row.grant_access === true ? 'granted' : 'default');
        }
      }
      setAccess(a);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const cycler = (roleKey, moduleKey, grantable) => {
    const cycle = grantable ? CYCLE : CYCLE_SANS_ACCORD;
    setAccess((prev) => {
      const courant = prev[roleKey]?.[moduleKey] || 'default';
      const i = cycle.indexOf(courant);
      const suivant = cycle[(i + 1) % cycle.length];
      return { ...prev, [roleKey]: { ...prev[roleKey], [moduleKey]: suivant } };
    });
    setMsg(''); setAvertissement('');
  };

  const setRoleAll = (roleKey, etat) => {
    setAccess((prev) => {
      const next = { ...prev[roleKey] };
      for (const m of modules) {
        // On n'applique jamais « accordé » en masse à un module non accordable :
        // la case resterait verte à l'écran et retomberait par défaut au
        // serveur — un écran qui ment sur ce qu'il a enregistré.
        next[m.key] = etat === 'granted' && !m.grantable ? 'default' : etat;
      }
      return { ...prev, [roleKey]: next };
    });
    setMsg(''); setAvertissement('');
  };

  const save = async () => {
    setSaving(true); setError(''); setMsg(''); setAvertissement('');
    try {
      const entries = [];
      for (const r of roles) {
        for (const m of modules) {
          entries.push({ role: r.key, module_key: m.key, state: access[r.key]?.[m.key] || 'default' });
        }
      }
      const res = await api.put('/permissions/matrix', { entries });
      setMsg("Habilitations enregistrées. Les accès prennent effet au prochain chargement de l'application pour les utilisateurs concernés.");
      // Le serveur peut avoir ramené un accord à « par défaut ». On le DIT au
      // lieu de laisser l'écran afficher un état que la base ne porte pas.
      const refuses = res.data?.refuses || [];
      if (refuses.length) {
        setAvertissement(
          `${refuses.length} accord(s) non enregistré(s) : l'Administration ne peut pas être accordée par la matrice ` +
          `(elle commande les comptes, la base de données et cette page). Ces cases sont revenues « par défaut ».`
        );
        await load();
      }
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
          subtitle="Créez des rôles, retirez-leur des modules ou accordez-leur-en"
          icon={ShieldCheck}
          actions={<button onClick={save} disabled={saving} className="btn-primary text-sm">{saving ? 'Enregistrement…' : 'Enregistrer la matrice'}</button>}
        />

        {error && <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{error}</span></div>}
        {msg && <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm"><CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{msg}</span></div>}
        {avertissement && <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /><span>{avertissement}</span></div>}

        {/* Créer un rôle par duplication */}
        <div className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-slate-700 mb-1 flex items-center gap-2"><Copy className="w-4 h-4" /> Créer un rôle (duplication)</h3>
          <p className="text-xs text-slate-500 mb-3">
            Le nouveau rôle <strong>hérite des accès du rôle source</strong> (son modèle), puis s'ajuste dans la matrice ci-dessous —
            on lui <strong>retire</strong> ce qu'il ne doit pas voir, on lui <strong>accorde</strong> ce que son modèle n'ouvre pas.
            Exemple : dupliquer « Collaborateur » pour créer « Encadrant collecte », puis lui <strong>accorder</strong> « Opérations ».
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-slate-500">Nom du nouveau rôle</label>
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ex : Encadrant collecte, Logistique…" className="input-modern mt-1" />
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

        {/* Légende — ce que fait réellement chaque état */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 text-sm">
          <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p><strong>Cliquez une case</strong> pour faire défiler les trois états :</p>
            <ul className="space-y-1">
              {CYCLE.map((k) => {
                const e = ETATS[k];
                return (
                  <li key={k} className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded border inline-flex items-center justify-center ${e.classe}`}>
                      <e.Icone className="w-3.5 h-3.5" strokeWidth={3} />
                    </span>
                    <span><strong>{e.libelle}</strong> — {e.aide}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-sky-800">
              Un accord ouvre les écrans de la section <strong>et l'API correspondante</strong> : ce n'est pas un simple
              affichage de menu. Il ne lève en revanche <strong>aucun masquage de données</strong> — un profil à qui l'on accorde
              « RH et Insertion » ne voit ni salaire, ni RQTH, ni détail de santé s'il n'est pas RH.
            </p>
            <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              <strong>Avant d'accorder au rôle « Collaborateur » :</strong> les sessions <strong>chauffeur</strong> du
              mobile portent ce rôle. Lui accorder un module l'ouvre donc aussi à tous les téléphones en tournée.
              Pour n'équiper que certaines personnes, <strong>créez un rôle dédié</strong> par duplication et accordez-lui
              le module à lui.
            </p>
            <p className="text-sky-800">
              L'<strong>Administrateur voit toujours tout</strong>. L'<strong>Administration</strong> ne peut pas être accordée
              <Lock className="w-3 h-3 inline mx-1 mb-0.5" /> : elle commande les comptes, la base de données et cette page —
              elle se donne en attribuant le profil Administrateur, en connaissance de cause.
            </p>
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
                      <button onClick={() => setRoleAll(r.key, 'granted')} title="Accorder tous les modules accordables" className="text-[10px] text-teal-600 hover:underline">accorder</button>
                      <span className="text-slate-300">·</span>
                      <button onClick={() => setRoleAll(r.key, 'default')} title="Tout remettre par défaut" className="text-[10px] text-slate-500 hover:underline">défaut</button>
                      <span className="text-slate-300">·</span>
                      <button onClick={() => setRoleAll(r.key, 'denied')} title="Refuser tous les modules" className="text-[10px] text-red-500 hover:underline">refuser</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.key} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="p-3 font-medium text-slate-700 sticky left-0 bg-white">
                    <span className="inline-flex items-center gap-1.5">
                      {m.label}
                      {!m.grantable && <Lock className="w-3 h-3 text-slate-400" title="Ce module ne peut pas être accordé — il se donne avec le profil Administrateur" />}
                    </span>
                  </td>
                  {roles.map((r) => {
                    const etat = ETATS[access[r.key]?.[m.key] || 'default'];
                    const grantable = m.grantable !== false;
                    return (
                      <td key={r.key} className="p-3 text-center">
                        <button
                          onClick={() => cycler(r.key, m.key, grantable)}
                          title={`${r.label} / ${m.label} — ${etat.libelle} : ${etat.aide}`}
                          aria-label={`${r.label}, ${m.label} : ${etat.libelle}. Cliquer pour changer.`}
                          className={`w-6 h-6 rounded border transition inline-flex items-center justify-center ${etat.classe}`}
                        >
                          <etat.Icone className="w-4 h-4" strokeWidth={3} />
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
          « ≈ » indique le rôle de base d'un rôle personnalisé. Un cadenas signale un module qui ne peut pas être accordé.
        </p>
      </div>
    </Layout>
  );
}
