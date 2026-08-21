import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Copy, Check, RefreshCw, AlertTriangle, Smartphone, CheckCircle2, XCircle } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import StatusBadge from './StatusBadge';

/**
 * Panel « Démo formation ».
 *
 * Un véhicule dédié « DÉMO FORMATION » possède son propre lien mobile
 * `/v/<token>`, utilisé pour former les stagiaires chauffeurs-collecteurs
 * sur l'application mobile SANS toucher aux données réelles de l'entreprise
 * (toutes les écritures durables sont neutralisées côté serveur — contrat
 * GET /tours/demo/access-info + POST /tours/demo/reset).
 *
 * Ce panel donne au formateur :
 *   - le lien à copier/coller sur le téléphone du stagiaire (même pattern
 *     de copie presse-papier que VehicleAccessPanel, avec le même repli
 *     si l'API clipboard est indisponible) ;
 *   - l'état de la tournée de démo en cours ;
 *   - un bouton de remise à zéro (confirmation explicite, état de
 *     chargement, message de succès/échec toujours visible) ;
 *   - un mode d'emploi court et un avertissement « réservé aux formations ».
 *
 * Visible ADMIN + MANAGER uniquement (un rôle personnalisé est résolu via
 * `base_role` — même convention que EnergieGES.jsx / HomeRedirect
 * d'App.jsx). Contrairement à VehicleAccessPanel, ce panel ne prend pas
 * de véhicule en paramètre : il n'existe qu'un seul véhicule de démo,
 * résolu côté serveur.
 */
export default function DemoFormationPanel() {
  const { user } = useAuth();
  const base = user?.base_role || user?.role;
  const canView = ['ADMIN', 'MANAGER'].includes(base);

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetFeedback, setResetFeedback] = useState(null); // { ok, message }

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api.get('/tours/demo/access-info')
      .then((res) => setInfo(res.data))
      .catch((err) => {
        setInfo(null);
        setLoadError(err.response?.data?.error || "Impossible de charger les informations de la démo formation.");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    load();
  }, [canView, load]);

  if (!canView) return null;

  const copyUrl = async () => {
    if (!info?.url) return;
    setCopyError('');
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Copie impossible — sélectionne et copie manuellement le lien ci-dessus.');
    }
  };

  const doReset = async () => {
    setResetting(true);
    setResetFeedback(null);
    try {
      const res = await api.post('/tours/demo/reset');
      const nb = res.data?.nb_cav;
      setResetFeedback({
        ok: true,
        message: res.data?.message || `Démo réinitialisée${nb != null ? ` — ${nb} point(s) à collecter` : ''}.`,
      });
      setShowConfirm(false);
      load();
    } catch (err) {
      setResetFeedback({
        ok: false,
        message: err.response?.data?.error || 'La réinitialisation de la démo a échoué.',
      });
      setShowConfirm(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="card-modern p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
          <GraduationCap className="w-5 h-5 text-purple-600" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <h3 className="font-bold">Démo formation</h3>
          <p className="text-xs text-slate-500">Lien mobile dédié aux formations, sur le véhicule « DÉMO FORMATION ».</p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-2">Chargement…</div>
      ) : loadError ? (
        <ErrorState
          variant="card"
          title="Impossible de charger la démo formation"
          message={loadError}
          onRetry={load}
        />
      ) : !info?.disponible ? (
        <EmptyState
          icon={GraduationCap}
          title="Démo formation non installée"
          description={info?.message || "Un administrateur doit lancer le script d'installation de la démo formation côté serveur (véhicule et tournée dédiés) avant de pouvoir récupérer ce lien."}
        />
      ) : (
        <>
          {/* Avertissement — réservé aux formations */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs mb-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
            <p>
              Ce lien est <span className="font-semibold">réservé aux formations</span>. Les actions faites depuis ce lien
              (collecte, incident, pesée...) n'ont <span className="font-semibold">aucun effet sur les données réelles</span> de l'entreprise.
            </p>
          </div>

          {/* URL de démo + copier */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3">
            <div className="text-xs text-slate-400 mb-1">Lien à ouvrir sur le téléphone du stagiaire</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-sm text-slate-800 truncate" title={info.url}>
                {info.url}
              </code>
              <button
                type="button"
                onClick={copyUrl}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex-shrink-0 ${
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {copied ? <Check className="w-3.5 h-3.5" strokeWidth={2} /> : <Copy className="w-3.5 h-3.5" strokeWidth={2} />}
                {copied ? 'Copié' : 'Copier'}
              </button>
            </div>
            {copyError && <p className="text-xs text-red-600 mt-1.5">{copyError}</p>}
            {info.vehicle && (
              <p className="text-xs text-slate-400 mt-2">
                Véhicule : <span className="font-medium text-slate-600">{info.vehicle.name || info.vehicle.registration || '—'}</span>
                {info.vehicle.registration && info.vehicle.name ? ` (${info.vehicle.registration})` : ''}
              </p>
            )}
          </div>

          {/* Etat de la tournée de démo */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3">
            <div className="text-xs text-slate-400 mb-2">Tournée de démo</div>
            {info.tour ? (
              <>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium text-slate-700">
                    {info.tour.date ? new Date(info.tour.date).toLocaleDateString('fr-FR') : '—'}
                  </span>
                  <StatusBadge status={info.tour.status} type="tournee" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-200 rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-purple-500"
                      style={{
                        width: `${info.tour.nb_cav ? Math.min(100, Math.round(((info.tour.nb_collectes || 0) / info.tour.nb_cav) * 100)) : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium text-slate-600 flex-shrink-0">
                    {info.tour.nb_collectes ?? 0} / {info.tour.nb_cav ?? 0} points collectés
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">Aucune tournée de démo active pour l'instant — réinitialise la démo pour en créer une.</p>
            )}
            {info.reinitialisee_le && (
              <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-200">
                Dernière réinitialisation : {new Date(info.reinitialisee_le).toLocaleString('fr-FR')}
              </p>
            )}
          </div>

          {/* Mode d'emploi formateur */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-sm text-blue-900">
            <div className="flex items-start gap-2">
              <Smartphone className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
              <div>
                <p className="font-semibold mb-1">Mode d'emploi formateur</p>
                <ol className="list-decimal list-inside text-xs leading-relaxed space-y-0.5 text-blue-800">
                  <li>Ouvre le lien ci-dessus dans le navigateur du téléphone du stagiaire</li>
                  <li>Si besoin, menu du navigateur → <em>Ajouter à l'écran d'accueil</em> (pratique pour plusieurs sessions)</li>
                  <li>Réinitialise la démo entre deux stagiaires avec le bouton ci-dessous</li>
                </ol>
              </div>
            </div>
          </div>

          {/* Feedback de la réinitialisation (succès/échec toujours visible) */}
          {resetFeedback && (
            <div
              role="alert"
              className={`flex items-center gap-2 p-3 rounded-lg text-sm mb-3 ${
                resetFeedback.ok
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}
            >
              {resetFeedback.ok ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
              ) : (
                <XCircle className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
              )}
              <span>{resetFeedback.message}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => { setResetFeedback(null); setShowConfirm(true); }}
            disabled={resetting}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-purple-700 px-3 py-2 rounded-md hover:bg-purple-50 transition-colors disabled:opacity-50"
            title="Remet la démo à zéro : nouvelle tournée de démo, tous les points redeviennent à collecter"
          >
            <RefreshCw className={`w-4 h-4 ${resetting ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            {resetting ? 'Réinitialisation…' : 'Réinitialiser la démo'}
          </button>
        </>
      )}

      <ConfirmDialog
        isOpen={showConfirm}
        onCancel={() => { if (!resetting) setShowConfirm(false); }}
        onConfirm={doReset}
        title="Réinitialiser la démo formation ?"
        message="La tournée de démo va être remise à zéro : tous les points redeviennent à collecter. Cette action est sans effet sur les données réelles de l'entreprise — à faire entre deux stagiaires, jamais en pleine session."
        confirmLabel="Réinitialiser"
        confirmVariant="danger"
        loading={resetting}
      />
    </div>
  );
}
