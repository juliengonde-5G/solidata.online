/**
 * « Écran en direct » — ce que le poste de pointage affiche en ce moment.
 *
 * CE QUE C'EST : la playlist RÉELLE du poste, rejouée ici avec ses vraies
 * durées et son vrai ordre. Elle est construite côté serveur par la fonction
 * même que sert l'API device (`construirePlaylist`) : mêmes annonces, mêmes
 * actualités, mêmes tournées, mêmes chiffres de VAK, mêmes médias. Aucun
 * second calcul, donc aucune divergence possible entre cet écran et l'atelier.
 *
 * CE QUE CE N'EST PAS : une caméra sur la dalle du Raspberry. Pendant les
 * quelques secondes qui suivent un badgeage, le poste affiche le prénom et
 * l'initiale d'un salarié (ADR-0004 §1) ; en filmer l'écran créerait un second
 * traitement de données personnelles, stocké et rejouable — précisément ce que
 * la note juridique interdit au dispositif. La restitution part donc de la
 * source, et l'écran de badgeage n'y figure jamais.
 *
 * DÉSYNCHRONISATION ASSUMÉE, ET DITE : le poste ne rapporte pas quel écran il
 * joue (le canal local ne remonte rien vers le serveur). La rotation ci-dessous
 * est donc la nôtre : les mêmes écrans, dans le même ordre, pas forcément à la
 * même seconde.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Tv, RefreshCw, Pause, Play, ChevronLeft, ChevronRight, Info, ShieldAlert, Scale } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, EmptyState } from '../../components';
import { apiErr, fmtDateTimeParis, TYPE_CONTENU_LABELS, EnLigneBadge } from './badgeuseShared';
import PrevisualisationContenu from './PrevisualisationContenu';

// Rafraîchissement de la playlist. Le poste, lui, la redemande toutes les
// 15 minutes (300 s les jours de VAK) : 60 s ici, c'est confortable pour un
// écran de contrôle ouvert quelques minutes, sans marteler le serveur.
const RAFRAICHISSEMENT_MS = 60000;

export default function EcranDirect() {
  const [data, setData] = useState(null);
  const [postes, setPostes] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [index, setIndex] = useState(0);
  const [enPause, setEnPause] = useState(false);
  const minuteur = useRef(null);

  // Liste des postes : utile dès qu'il y en a plus d'un (multi-site). Échec
  // sans conséquence — l'écran fonctionne sur le poste par défaut.
  useEffect(() => {
    api.get('/badgeuse/devices')
      .then((r) => setPostes(Array.isArray(r.data?.devices) ? r.data.devices : []))
      .catch(() => setPostes([]));
  }, []);

  const load = useCallback((silencieux = false) => {
    if (!silencieux) setLoading(true);
    api.get('/badgeuse/ecran-direct', { params: deviceId ? { device_id: deviceId } : {} })
      .then((r) => {
        setData(r.data || null);
        setError(null);
        // L'index est borné à la nouvelle longueur : une playlist raccourcie
        // entre deux rafraîchissements laisserait sinon un écran vide.
        setIndex((i) => {
          const n = (r.data?.elements || []).length;
          return n === 0 ? 0 : Math.min(i, n - 1);
        });
      })
      .catch((err) => setError(apiErr(err, 'Écran en direct indisponible.')))
      .finally(() => setLoading(false));
  }, [deviceId]);

  useEffect(() => { load(); }, [load]);

  // Rafraîchissement silencieux : la playlist change (une tournée avance, une
  // brève arrive), l'écran ne doit pas clignoter pour autant.
  useEffect(() => {
    const t = setInterval(() => load(true), RAFRAICHISSEMENT_MS);
    return () => clearInterval(t);
  }, [load]);

  const elements = useMemo(() => data?.elements || [], [data]);
  const courant = elements[index] || null;

  // Rotation : la durée est celle que le poste applique réellement.
  useEffect(() => {
    if (minuteur.current) clearTimeout(minuteur.current);
    if (enPause || elements.length < 2 || !courant) return undefined;
    const duree = Math.min(60, Math.max(5, Number(courant.duree_sec) || 10)) * 1000;
    minuteur.current = setTimeout(() => setIndex((i) => (i + 1) % elements.length), duree);
    return () => { if (minuteur.current) clearTimeout(minuteur.current); };
  }, [index, enPause, elements, courant]);

  const aller = (delta) => {
    if (elements.length === 0) return;
    setIndex((i) => (i + delta + elements.length) % elements.length);
  };

  if (loading) return <LoadingSpinner size="lg" message="Lecture de la playlist du poste…" />;
  if (error) return <ErrorState variant="card" title="Écran en direct indisponible" message={error} onRetry={() => load()} />;

  const poste = data?.poste || null;

  return (
    <div className="space-y-4">
      <div role="note" className="rounded-lg border border-slate-200 bg-slate-50 text-slate-600 text-xs px-3 py-2 flex items-start gap-2">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
        <span>
          Restitution de la playlist <strong>réellement servie au poste</strong> — mêmes écrans, même ordre, mêmes durées,
          calculés par le serveur au moment où vous lisez cette page. Ce n'est pas une capture de la dalle : l'écran de
          badgeage (prénom + initiale d'un salarié) n'est jamais retransmis ici, et la rotation ci-dessous est celle de
          votre navigateur — le poste ne dit pas à quelle seconde il en est.
        </span>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Tv className="w-4 h-4 text-teal-600" /> Écran du poste
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {postes.length > 1 && (
              <select value={deviceId || ''} onChange={(e) => setDeviceId(e.target.value || null)}
                aria-label="Poste à visualiser" className="input-modern py-1.5 text-sm">
                <option value="">Poste par défaut</option>
                {postes.map((p) => <option key={p.id} value={p.id}>{p.code}{p.libelle ? ` — ${p.libelle}` : ''}</option>)}
              </select>
            )}
            <button onClick={() => load()} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4" /> Actualiser
            </button>
          </div>
        </div>

        {/* État du poste — ce que la restitution ne peut PAS dire toute seule :
            un poste éteint n'affiche rien, quelle que soit la playlist. */}
        <div className="flex items-center gap-3 flex-wrap text-sm text-slate-600 mb-3">
          {poste ? (
            <>
              <span className="font-medium text-slate-800">{poste.code}{poste.libelle ? ` — ${poste.libelle}` : ''}</span>
              {poste.site_code && <span className="text-slate-400">site {poste.site_code}</span>}
              <EnLigneBadge enLigne={!!poste.online} />
              <span className="text-xs text-slate-400">
                {poste.dernier_heartbeat
                  ? `dernier signe de vie ${fmtDateTimeParis(poste.dernier_heartbeat)}`
                  : 'aucun signe de vie depuis l’appairage'}
              </span>
              {!poste.online && (
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                  Le poste est muet depuis plus de {data?.silence_minutes || 15} min : ce qu'il affiche vraiment peut différer.
                </span>
              )}
              {poste.alerte && (
                <span className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5 inline-flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" /> {poste.alerte}
                </span>
              )}
            </>
          ) : (
            <span className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 text-xs">
              Aucun poste appairé — voici la playlist commune, celle qui partira au premier poste installé.
            </span>
          )}
          {data?.vak_du_jour && (
            <span className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-0.5 inline-flex items-center gap-1">
              <Scale className="w-3 h-3" /> Vente au Kilo en cours : les contenus « jours de VAK » sont diffusés
            </span>
          )}
        </div>

        {elements.length === 0 ? (
          <EmptyState icon={Tv} title="Playlist vide"
            description="Aucun écran n'est diffusé en ce moment. Les générateurs sans donnée du jour (annonces, tournées, VAK…) sont retirés de la playlist plutôt que d'afficher un écran vide." />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <PrevisualisationContenu contenu={courant} sansPied />
              <div className="flex items-center justify-between gap-2 mt-2">
                <span className="text-xs text-slate-500">
                  Écran {index + 1} / {elements.length} — {TYPE_CONTENU_LABELS[courant?.type] || courant?.type}
                  {courant?.duree_sec ? ` · ${courant.duree_sec} s` : ''}
                </span>
                <div className="flex items-center gap-1">
                  <button onClick={() => aller(-1)} className="p-1.5 text-slate-400 hover:text-teal-700" aria-label="Écran précédent"><ChevronLeft className="w-4 h-4" /></button>
                  <button onClick={() => setEnPause((p) => !p)} className="p-1.5 text-slate-400 hover:text-teal-700"
                    aria-label={enPause ? 'Reprendre la rotation' : 'Mettre la rotation en pause'}>
                    {enPause ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </button>
                  <button onClick={() => aller(1)} className="p-1.5 text-slate-400 hover:text-teal-700" aria-label="Écran suivant"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            </div>

            {/* Séquence complète : le contrôle le plus utile n'est pas l'écran
                courant mais l'ENCHAÎNEMENT — c'est là qu'on voit qu'un écran
                manque ou qu'un autre revient trop souvent. */}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Séquence diffusée</h4>
              <ol className="space-y-1 max-h-[22rem] overflow-y-auto pr-1">
                {elements.map((el, i) => (
                  <li key={`${el.id}-${i}`}>
                    <button onClick={() => { setIndex(i); setEnPause(true); }}
                      className={`w-full text-left text-xs rounded-lg px-2 py-1.5 border transition ${i === index ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-transparent hover:bg-slate-50 text-slate-600'}`}>
                      <span className="font-medium">{i + 1}. {TYPE_CONTENU_LABELS[el.type] || el.type}</span>
                      {el.titre && <span className="text-slate-400"> — {el.titre}</span>}
                      <span className="text-slate-400"> · {el.duree_sec || 10} s</span>
                    </button>
                  </li>
                ))}
              </ol>
              <p className="text-[11px] text-slate-400 mt-2">
                Durée totale du cycle : {Math.round(elements.reduce((s, el) => s + (Number(el.duree_sec) || 10), 0) / 6) / 10} min.
                {data?.genere_le && ` Playlist lue à ${fmtDateTimeParis(data.genere_le)}.`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
