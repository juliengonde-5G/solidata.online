import { useEffect, useState } from 'react';
import { KeyRound, Copy, RefreshCw, Check, AlertTriangle, Smartphone } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

/**
 * Panel d'accès véhicule (« 1 URL = 1 véhicule »).
 *
 * Affiché dans la fiche véhicule (onglet Détail).
 *
 * Bug Lot 9 : le panel était réservé ADMIN alors que le pairing D3
 * (CLAUDE.md §7) est explicitement fait « en personne » par le MANAGER
 * au dépôt — un MANAGER ouvrant /vehicles (rôle pourtant admis sur la
 * page, cf App.jsx) ne voyait donc rien du tout, sans aucune erreur.
 * Lecture ouverte à ADMIN + MANAGER (aligné sur le backend, y compris
 * un rôle personnalisé dont le `base_role` résout vers MANAGER — cf.
 * ProtectedRoute dans App.jsx pour le même pattern). La régénération
 * (révocation immédiate de l'ancien raccourci) reste réservée ADMIN.
 *
 * Fonctions :
 *   - Affiche l'URL d'accès courante (à copier sur le téléphone du chauffeur).
 *   - Bouton Copier (clipboard API + feedback visuel).
 *   - Bouton Régénérer (ADMIN seul — révoque l'ancienne URL, confirme avant).
 *   - Mode d'emploi manager pour le pairing physique au dépôt (D3).
 */
export default function VehicleAccessPanel({ vehicleId, registration, name }) {
  const { user } = useAuth();
  const [accessInfo, setAccessInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Lecture : ADMIN + MANAGER (le backend authorize('ADMIN','MANAGER')
  // résout aussi les rôles personnalisés via base_role — même garde ici).
  const isAdmin = user?.role === 'ADMIN';
  const isManager = user?.role === 'MANAGER' || user?.base_role === 'MANAGER';
  const canView = isAdmin || isManager;

  useEffect(() => {
    if (!vehicleId || !canView) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get(`/vehicles/${vehicleId}/access-info`)
      .then((res) => { if (!cancelled) setAccessInfo(res.data); })
      .catch((err) => {
        if (cancelled) return;
        const msg = err.response?.data?.error || "Impossible de charger l'URL d'accès";
        setError(msg);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vehicleId, canView]);

  if (!canView) return null;

  const copyUrl = async () => {
    if (!accessInfo?.mobile_url) return;
    try {
      await navigator.clipboard.writeText(accessInfo.mobile_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copie impossible — sélectionne et copie manuellement.');
    }
  };

  const regenerate = async () => {
    const label = name || registration || 'ce véhicule';
    const ok = window.confirm(
      `Régénérer l'URL d'accès de ${label} ?\n\n` +
      `L'ancien raccourci sur l'écran d'accueil du chauffeur sera immédiatement invalide. ` +
      `Tu devras reparamétrer le téléphone avec la nouvelle URL.`
    );
    if (!ok) return;
    setRegenerating(true);
    setError('');
    try {
      const res = await api.post(`/vehicles/${vehicleId}/regenerate-token`);
      setAccessInfo(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Régénération impossible');
    }
    setRegenerating(false);
  };

  return (
    <div className="card-modern p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <KeyRound className="w-5 h-5 text-primary" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <h3 className="font-bold">Accès chauffeur</h3>
          <p className="text-xs text-slate-500">URL unique liée à ce véhicule — à paramétrer une fois sur le téléphone du chauffeur.</p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400 py-2">Chargement…</div>
      ) : error ? (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      ) : accessInfo ? (
        <>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3">
            <div className="text-xs text-slate-400 mb-1">URL d'accès</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-sm text-slate-800 truncate" title={accessInfo.mobile_url}>
                {accessInfo.mobile_url}
              </code>
              <button
                type="button"
                onClick={copyUrl}
                className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                  copied
                    ? 'bg-green-100 text-green-700'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {copied ? <Check className="w-3.5 h-3.5" strokeWidth={2} /> : <Copy className="w-3.5 h-3.5" strokeWidth={2} />}
                {copied ? 'Copié' : 'Copier'}
              </button>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-sm text-blue-900">
            <div className="flex items-start gap-2">
              <Smartphone className="w-4 h-4 flex-shrink-0 mt-0.5" strokeWidth={1.8} />
              <div>
                <p className="font-semibold mb-1">Paramétrer un téléphone chauffeur</p>
                <ol className="list-decimal list-inside text-xs leading-relaxed space-y-0.5 text-blue-800">
                  <li>Ouvre l'URL dans le navigateur du téléphone du chauffeur</li>
                  <li>Menu navigateur → <em>Ajouter à l'écran d'accueil</em></li>
                  <li>Nomme le raccourci avec l'immatriculation (ex. {registration || 'AB-123-CD'})</li>
                </ol>
                <p className="text-xs mt-2 text-blue-700">
                  Ensuite, un seul tap sur le raccourci suffit pour démarrer une tournée.
                </p>
              </div>
            </div>
          </div>

          {isAdmin ? (
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-red-600 px-3 py-2 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
              title="Génère une nouvelle URL et invalide l'ancienne immédiatement"
            >
              <RefreshCw className={`w-4 h-4 ${regenerating ? 'animate-spin' : ''}`} strokeWidth={1.8} />
              {regenerating ? 'Régénération…' : "Régénérer l'URL (révoque l'ancien raccourci)"}
            </button>
          ) : (
            <p className="text-xs text-slate-400 px-3">
              La régénération de l'URL (en cas de perte du téléphone ou de changement de chauffeur) est réservée à un administrateur.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
