/**
 * Presse & actualité locale (ADR-0006 + addendum du 10/09/2026) — les flux
 * RSS que le SERVEUR va chercher pour l'écran du poste.
 *
 * POURQUOI CET ÉCRAN EXISTE : les flux vivaient uniquement dans un réglage de
 * base de données. Ajouter le journal local supposait donc une intervention
 * technique — autant dire que la fonction n'existait pas pour l'exploitant.
 *
 * POURQUOI LE BOUTON « TESTER » N'EST PAS UN CONFORT : une adresse de flux RSS
 * ne se devine pas, change sans prévenir, et une erreur ne se voit qu'en
 * regardant l'écran de l'atelier rester vide pendant deux jours. Ici le
 * serveur va le chercher tout de suite et rend le titre du premier article :
 * c'est la seule preuve qu'on a attrapé le bon fil.
 *
 * Contrat (routes/badgeuse.js) :
 *   GET  /badgeuse/presse/status → { sync_actif, articles_par_flux, vignettes,
 *        video_autorisee, retention_jours, flux:[{libelle,source,url,actif,
 *        portee}], par_portee:[{portee,articles,dernier}] | null }   (AFFICHAGE_READ)
 *   PUT  /badgeuse/presse/config { flux?, sync_actif?, articles_par_flux?,
 *        vignettes? }                                              (AFFICHAGE_WRITE)
 *   POST /badgeuse/presse/tester { url } → { ok, articles, premier_titre?,
 *        premier_publie_le?, vignette_disponible?, motif? }         (AFFICHAGE_WRITE)
 *   POST /badgeuse/presse/sync → bilan de rapatriement               (AFFICHAGE_WRITE)
 */
import { useState, useEffect, useCallback } from 'react';
import { Newspaper, RefreshCw, Plus, Trash2, Info, CheckCircle2, XCircle, Search } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, useToast } from '../../components';
import { apiErr, fmtDateTimeParis } from './badgeuseShared';

const FLUX_MAX = 5;
const PORTEES = [
  { value: 'nationale', label: 'Nationale' },
  { value: 'locale', label: 'Locale' },
];
const fluxVide = () => ({ libelle: '', source: '', url: '', actif: false, portee: 'locale' });

export default function PresseActualite({ canWrite }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [flux, setFlux] = useState([]);
  const [syncActif, setSyncActif] = useState(false);
  const [articlesParFlux, setArticlesParFlux] = useState(8);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Résultat d'essai PAR LIGNE : un essai global ne dirait pas lequel a échoué.
  const [essais, setEssais] = useState({});
  const [essaiEnCours, setEssaiEnCours] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    api.get('/badgeuse/presse/status')
      .then((r) => {
        const d = r.data || {};
        setStatus(d);
        setFlux(Array.isArray(d.flux) ? d.flux : []);
        setSyncActif(!!d.sync_actif);
        setArticlesParFlux(d.articles_par_flux ?? 8);
      })
      .catch((err) => setError(apiErr(err, 'Chargement des flux de presse impossible.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const majFlux = (idx, patch) => setFlux((l) => l.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const retirerFlux = (idx) => {
    setFlux((l) => l.filter((_, i) => i !== idx));
    setEssais((e) => { const c = { ...e }; delete c[idx]; return c; });
  };

  const enregistrer = async () => {
    const propres = flux
      .map((f) => ({ ...f, url: String(f.url || '').trim() }))
      .filter((f) => f.url);
    setSaving(true);
    try {
      await api.put('/badgeuse/presse/config', {
        flux: propres, sync_actif: syncActif, articles_par_flux: parseInt(articlesParFlux, 10) || 8,
      });
      toast.success('Flux de presse enregistrés.');
      load();
    } catch (err) { toast.error(apiErr(err, 'Enregistrement des flux impossible.')); }
    finally { setSaving(false); }
  };

  const tester = async (idx) => {
    const url = String(flux[idx]?.url || '').trim();
    if (!url) { toast.error("Renseignez l'adresse du flux avant de le tester."); return; }
    setEssaiEnCours(idx);
    try {
      const r = await api.post('/badgeuse/presse/tester', { url });
      setEssais((e) => ({ ...e, [idx]: r.data || {} }));
    } catch (err) {
      setEssais((e) => ({ ...e, [idx]: { ok: false, motif: apiErr(err, 'Essai impossible.') } }));
    } finally { setEssaiEnCours(null); }
  };

  const synchroniser = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/badgeuse/presse/sync');
      const b = r.data || {};
      if (b.ignore === 'desactive') toast.error('Rapatriement désactivé : cochez « Rapatrier les articles automatiquement ».');
      else toast.success(`${b.articles || 0} article(s) rapatrié(s), ${b.vignettes || 0} vignette(s), ${b.erreurs || 0} anomalie(s).`);
      load();
    } catch (err) { toast.error(apiErr(err, 'Synchronisation impossible.')); }
    finally { setSyncing(false); }
  };

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const compteur = (portee) => (status?.par_portee || []).find((p) => p.portee === portee);
  const locale = compteur('locale');
  const nationale = compteur('nationale');

  return (
    <div className="card-modern p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-primary" /> Presse &amp; actualité locale
        </h3>
        {canWrite && (
          <button onClick={synchroniser} disabled={syncing} className="btn-secondary text-sm inline-flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Rapatriement…' : 'Rapatrier maintenant'}
          </button>
        )}
      </div>

      <p className="text-xs text-slate-500 flex items-start gap-2 mb-4">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Le <strong>serveur</strong> lit ces flux et range les articles ; le poste ne contacte jamais
          un site de presse et continue de tourner hors ligne sur le dernier état connu. Marquez un flux
          « locale » pour qu'il alimente un écran d'actualité locale : créez ensuite un contenu de type
          « Actualité de la presse » et choisissez la portée <em>Locale</em>.
        </span>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {[['Actualité locale', locale], ['Actualité nationale', nationale]].map(([titre, c]) => (
          <div key={titre} className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">{titre}</p>
            {status?.par_portee === null ? (
              <p className="text-sm text-amber-700 mt-1">Base non à jour — relancez le déploiement.</p>
            ) : c ? (
              <>
                <p className="text-lg font-semibold text-slate-800">{c.articles} article(s) en réserve</p>
                <p className="text-xs text-slate-500">Dernier : {c.dernier ? fmtDateTimeParis(c.dernier) : 'date inconnue'}</p>
              </>
            ) : (
              // Jamais « 0 » présenté comme un résultat : aucun article n'est
              // arrivé, c'est un état à nommer, pas un chiffre à afficher.
              <p className="text-sm text-slate-500 mt-1">Aucun article rapatrié pour l'instant.</p>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {flux.length === 0 && (
          <p className="text-sm text-slate-500 italic">
            Aucun flux configuré. Ajoutez l'adresse du flux RSS de votre source locale
            (page « flux RSS » du site du journal, de la Métropole ou de la radio régionale),
            puis testez-la.
          </p>
        )}
        {flux.map((f, idx) => {
          const essai = essais[idx];
          return (
            <div key={idx} className="rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input value={f.libelle || ''} onChange={(e) => majFlux(idx, { libelle: e.target.value })}
                  disabled={!canWrite} placeholder="Libellé (ex. Journal local — à la une)"
                  className="input-modern py-2 text-sm md:col-span-2" maxLength={120} />
                <input value={f.source || ''} onChange={(e) => majFlux(idx, { source: e.target.value })}
                  disabled={!canWrite} placeholder="Source affichée à l'écran"
                  className="input-modern py-2 text-sm" maxLength={120} />
                <select value={f.portee || 'nationale'} onChange={(e) => majFlux(idx, { portee: e.target.value })}
                  disabled={!canWrite} className="input-modern py-2 text-sm">
                  {PORTEES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={f.url || ''} onChange={(e) => majFlux(idx, { url: e.target.value })}
                  disabled={!canWrite} placeholder="https://…/rss"
                  className="input-modern py-2 text-sm flex-1 min-w-[240px]" maxLength={600} />
                {canWrite && (
                  <>
                    <button onClick={() => tester(idx)} disabled={essaiEnCours === idx}
                      className="btn-secondary text-xs inline-flex items-center gap-1 py-2">
                      <Search className="w-3.5 h-3.5" />
                      {essaiEnCours === idx ? 'Essai…' : 'Tester le flux'}
                    </button>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="checkbox" checked={f.actif === true}
                        onChange={(e) => majFlux(idx, { actif: e.target.checked })} />
                      Actif
                    </label>
                    <button onClick={() => retirerFlux(idx)} className="text-rose-600 hover:text-rose-700 p-1" title="Retirer ce flux">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
              {essai && (
                <p className={`text-xs flex items-start gap-1.5 ${essai.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {essai.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                  <span>
                    {essai.ok
                      ? `${essai.articles} article(s) lus — premier titre : « ${essai.premier_titre || 'sans titre'} »${essai.vignette_disponible ? ' (vignette disponible)' : ' (sans vignette)'}`
                      : essai.motif || 'Flux illisible.'}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {canWrite && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={() => setFlux((l) => [...l, fluxVide()])} disabled={flux.length >= FLUX_MAX}
            className="btn-secondary text-sm inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Ajouter un flux
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={syncActif} onChange={(e) => setSyncActif(e.target.checked)} />
            Rapatrier les articles automatiquement
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Articles par flux
            <input type="number" min={1} max={20} value={articlesParFlux}
              onChange={(e) => setArticlesParFlux(e.target.value)} className="input-modern py-1.5 text-sm w-20" />
          </label>
          <button onClick={enregistrer} disabled={saving} className="btn-primary text-sm ml-auto">
            {saving ? 'Enregistrement…' : 'Enregistrer les flux'}
          </button>
        </div>
      )}
      {flux.length >= FLUX_MAX && (
        <p className="text-xs text-slate-400 mt-2">Maximum {FLUX_MAX} flux — au-delà, la synchronisation devient plus longue que l'intervalle du poste.</p>
      )}
    </div>
  );
}
