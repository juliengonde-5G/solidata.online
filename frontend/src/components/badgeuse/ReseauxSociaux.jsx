/**
 * Réseaux sociaux (CDC_AFFICHAGE_V2.md §2/§4, ADR-0004 §6) : comptes suivis,
 * jeton Meta (chiffré AES-256-GCM côté serveur, jamais relu), synchronisation
 * manuelle. Contrat confirmé (routes/badgeuse.js + services/badgeuse-social.js) :
 *
 *   GET  /badgeuse/social/status  → { sync_actif, jeton_configure,
 *     jeton_configure_le, dernier_sync, posts_par_compte, comptes:[{reseau,
 *     compte, graph_id, actif}], posts:{total, dernier} }               (READ)
 *   PUT  /badgeuse/social/config  { meta_token?, comptes?, sync_actif? } (ADMIN)
 *     meta_token: null retire le jeton. comptes REMPLACE la liste entière.
 *   PUT  /badgeuse/parametres { social_posts_par_compte }        (ADMIN/RH)
 *   POST /badgeuse/social/sync    → { items, comptes, posts,
 *     videos_ignorees, erreurs, ignore?: 'desactive'|'sans_jeton' }     (ADMIN)
 *
 * `graph_id` (identifiant Meta Graph du compte) n'est JAMAIS deviné depuis le
 * nom d'utilisateur — sans lui, le compte est ignoré à la synchronisation.
 */
import { useState, useEffect, useCallback } from 'react';
import { Share2, KeyRound, RefreshCw, Info, ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, useToast } from '../../components';
import { apiErr, fmtDateTimeParis, DEFAULT_SOCIAL_COMPTES, RESEAUX_LABELS } from './badgeuseShared';

export default function ReseauxSociaux({ canWrite }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [comptes, setComptes] = useState(DEFAULT_SOCIAL_COMPTES);
  const [syncActif, setSyncActif] = useState(false);
  const [postsParCompte, setPostsParCompte] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savingPosts, setSavingPosts] = useState(false);
  const [token, setToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/badgeuse/social/status')
      .then((r) => {
        const d = r.data || {};
        setStatus(d);
        setComptes(Array.isArray(d.comptes) && d.comptes.length ? d.comptes : DEFAULT_SOCIAL_COMPTES);
        setSyncActif(!!d.sync_actif);
        setPostsParCompte(d.posts_par_compte ?? 5);
      })
      .catch((err) => setError(apiErr(err, 'Chargement des réseaux sociaux impossible.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const updateCompte = (idx, patch) => setComptes((list) => list.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const saveComptes = async () => {
    setSaving(true);
    try {
      await api.put('/badgeuse/social/config', {
        comptes: comptes.map((c) => ({
          reseau: c.reseau === 'facebook' ? 'facebook' : 'instagram',
          compte: String(c.compte || '').trim(),
          graph_id: c.graph_id ? String(c.graph_id).trim() : null,
          actif: !!c.actif,
        })).filter((c) => c.compte),
        sync_actif: syncActif,
      });
      toast.success('Comptes réseaux sociaux enregistrés.');
      load();
    } catch (err) { toast.error(apiErr(err, 'Enregistrement des comptes impossible.')); }
    finally { setSaving(false); }
  };

  const savePostsParCompte = async () => {
    const n = parseInt(postsParCompte, 10);
    if (!Number.isFinite(n) || n < 1 || n > 20) { toast.error('Nombre de posts par compte : entre 1 et 20.'); return; }
    setSavingPosts(true);
    try {
      await api.put('/badgeuse/parametres', { social_posts_par_compte: n });
      toast.success('Nombre de posts par compte enregistré.');
    } catch (err) { toast.error(apiErr(err, 'Enregistrement impossible.')); }
    finally { setSavingPosts(false); }
  };

  const saveToken = async (e) => {
    e.preventDefault();
    if (!token.trim()) return;
    setSavingToken(true);
    try {
      await api.put('/badgeuse/social/config', { meta_token: token.trim() });
      toast.success('Jeton Meta enregistré.');
      setToken('');
      load();
    } catch (err) { toast.error(apiErr(err, 'Enregistrement du jeton impossible.')); }
    finally { setSavingToken(false); }
  };

  const retirerToken = async () => {
    setSavingToken(true);
    try {
      await api.put('/badgeuse/social/config', { meta_token: null });
      toast.success('Jeton Meta retiré.');
      load();
    } catch (err) { toast.error(apiErr(err, 'Retrait du jeton impossible.')); }
    finally { setSavingToken(false); }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/badgeuse/social/sync');
      const b = r?.data || {};
      if (b.ignore === 'desactive') toast.error('Synchronisation désactivée — activez-la avant de synchroniser.');
      else if (b.ignore === 'sans_jeton') toast.error('Aucun jeton configuré — enregistrez le jeton Meta avant de synchroniser.');
      else {
        const extra = [
          b.videos_ignorees ? `${b.videos_ignorees} vidéo(s) ignorée(s) (V2)` : null,
          b.erreurs ? `${b.erreurs} anomalie(s)` : null,
        ].filter(Boolean).join(', ');
        toast.success(`${b.posts ?? 0} post(s) importé(s) sur ${b.comptes ?? 0} compte(s)${extra ? ` — ${extra}` : ''}.`);
      }
      load();
    } catch (err) { toast.error(apiErr(err, 'Synchronisation impossible.')); }
    finally { setSyncing(false); }
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement des réseaux sociaux…" />;
  if (error) return <ErrorState variant="card" title="Réseaux sociaux indisponibles" message={error} onRetry={load} />;

  return (
    <div className="bg-white rounded-xl border p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Share2 className="w-4 h-4 text-teal-600" /> Réseaux sociaux</h3>
        {canWrite && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={syncActif} onChange={(e) => setSyncActif(e.target.checked)} className="rounded border-slate-300" />
            Synchronisation automatique active
          </label>
        )}
      </div>

      <div role="note" className="rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-xs px-3 py-2 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <span>L'identifiant Graph (« graph_id ») de chaque compte n'est jamais deviné depuis son nom d'utilisateur — sans lui, le compte est ignoré à la synchronisation. Sans jeton configuré, partagez les publications via « Partager un lien ».</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
            <tr>
              <th className="text-left py-2 px-2">Réseau</th>
              <th className="text-left py-2 px-2">Compte</th>
              <th className="text-left py-2 px-2">Identifiant Graph</th>
              <th className="text-center py-2 px-2">Actif</th>
            </tr>
          </thead>
          <tbody>
            {comptes.map((c, idx) => (
              <tr key={`${c.reseau}-${idx}`} className="border-b border-slate-50">
                <td className="py-2 px-2 text-slate-600">
                  {canWrite ? (
                    <select value={c.reseau} onChange={(e) => updateCompte(idx, { reseau: e.target.value })} className="input-modern py-1.5 text-xs">
                      <option value="instagram">{RESEAUX_LABELS.instagram}</option>
                      <option value="facebook">{RESEAUX_LABELS.facebook}</option>
                    </select>
                  ) : (RESEAUX_LABELS[c.reseau] || c.reseau)}
                </td>
                <td className="py-2 px-2 font-medium text-slate-700">
                  {canWrite ? (
                    <input value={c.compte || ''} onChange={(e) => updateCompte(idx, { compte: e.target.value })} className="input-modern py-1.5 text-xs w-full" maxLength={100} />
                  ) : (c.compte)}
                </td>
                <td className="py-2 px-2">
                  {canWrite ? (
                    <input value={c.graph_id || ''} onChange={(e) => updateCompte(idx, { graph_id: e.target.value })} placeholder="non renseigné"
                      className="input-modern py-1.5 text-xs w-full font-mono" maxLength={100} />
                  ) : (
                    c.graph_id ? <span className="font-mono text-xs">{c.graph_id}</span> : <span className="text-amber-600 text-xs">non renseigné</span>
                  )}
                </td>
                <td className="py-2 px-2 text-center">
                  <input type="checkbox" checked={c.actif !== false} onChange={(e) => updateCompte(idx, { actif: e.target.checked })} disabled={!canWrite} className="rounded border-slate-300" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="flex justify-end">
          <button onClick={saveComptes} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer les comptes'}
          </button>
        </div>
      )}

      <div className="pt-4 border-t border-slate-100 flex items-center gap-3 flex-wrap">
        <label className="text-xs font-medium text-slate-600">Posts affichés par compte à chaque synchronisation</label>
        <input type="number" min={1} max={20} value={postsParCompte} onChange={(e) => setPostsParCompte(e.target.value)} disabled={!canWrite}
          className="input-modern py-1.5 text-xs w-20 disabled:bg-slate-50 disabled:text-slate-400" />
        {canWrite && (
          <button onClick={savePostsParCompte} disabled={savingPosts} className="btn-secondary text-xs disabled:opacity-50">
            {savingPosts ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        )}
      </div>

      <div className="pt-4 border-t border-slate-100">
        <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><KeyRound className="w-4 h-4 text-teal-600" /> Jeton API Meta Graph</h4>

        {status?.jeton_configure ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-3 py-2 flex items-center gap-2 mb-3 flex-wrap">
            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
            <span>Jeton configuré{status.jeton_configure_le ? ` le ${fmtDateTimeParis(status.jeton_configure_le)}` : ''}.</span>
            {canWrite && (
              <button onClick={retirerToken} disabled={savingToken} className="ml-auto text-xs text-emerald-700 hover:underline disabled:opacity-50">Retirer</button>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 mb-3">
            Aucun jeton configuré — sans jeton, partagez les publications via « Partager un lien » (onglet Affichage).
          </p>
        )}

        {canWrite && (
          <form onSubmit={saveToken} className="flex items-center gap-2 flex-wrap">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={status?.jeton_configure ? 'Remplacer le jeton…' : 'Coller le jeton Meta Graph…'}
              className="input-modern py-2 text-sm flex-1 min-w-[220px]" autoComplete="off" maxLength={500} />
            <button type="submit" disabled={savingToken || !token.trim()} className="btn-secondary text-sm disabled:opacity-50">
              {savingToken ? 'Enregistrement…' : 'Enregistrer le jeton'}
            </button>
          </form>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          Le jeton est chiffré (AES-256-GCM) côté serveur et n'est jamais relu en clair une fois enregistré.
        </p>

        <div className="flex items-center gap-3 mt-4 flex-wrap">
          {canWrite && (
            <button onClick={syncNow} disabled={syncing || !status?.jeton_configure} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> {syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
            </button>
          )}
          <span className="text-xs text-slate-500">
            {status?.dernier_sync
              ? `Dernière synchronisation : ${fmtDateTimeParis(status.dernier_sync)}${status.posts?.total != null ? ` — ${status.posts.total} post(s) au total` : ''}`
              : 'Aucune synchronisation enregistrée pour le moment.'}
          </span>
        </div>
        <p className="text-[11px] text-slate-400 mt-2">Stories vidéo : V2 (hors périmètre, ADR-0004 §6) — les vidéos sont ignorées à la synchronisation.</p>
      </div>
    </div>
  );
}
