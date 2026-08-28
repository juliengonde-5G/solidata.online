import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, BellOff, BellRing, ExternalLink } from 'lucide-react';
import {
  isPushSupported,
  enablePushNotifications,
  disablePushNotifications,
  isPushActive,
} from '../../services/pushNotifications';
import { signatureAlerte } from './useNotificationsNonLues';

// ══════════════════════════════════════════
// Onglet « Notifications » du bouton unique (ex-cloche NotificationBell).
//
// Reprend à l'identique ce que faisait la cloche de la barre supérieure :
// l'historique des alertes du tableau de bord (`GET /dashboard/kpis`) et le
// réglage des notifications push du navigateur. S'y ajoute l'état « lu / non
// lu » (cf. useNotificationsNonLues), qui n'existait pas : le compteur du
// bouton restait sinon figé sur le même nombre indéfiniment.
// ══════════════════════════════════════════

export default function PanneauNotifications({ alertes = [], estNonLue, onMarquerLu, actif = false }) {
  const [pushActive, setPushActive] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState(null);
  // Ce qui était non lu À L'OUVERTURE de l'onglet, figé : consulter vaut
  // lecture, mais si l'on effaçait les pastilles dans le même souffle,
  // l'utilisateur ne saurait jamais CE QUI était nouveau. Elles restent donc
  // affichées le temps de la consultation, et auront disparu la fois suivante.
  const [nouvelles, setNouvelles] = useState(() => new Set());
  const supported = isPushSupported();

  const estNonLueRef = useRef(estNonLue);
  estNonLueRef.current = estNonLue;
  const onMarquerLuRef = useRef(onMarquerLu);
  onMarquerLuRef.current = onMarquerLu;

  useEffect(() => {
    if (!supported) return;
    isPushActive().then(setPushActive).catch(() => {});
  }, [supported]);

  // Consulter l'onglet vaut lecture : c'est le seul geste qui puisse faire
  // retomber le compteur, faute d'accusé de lecture côté serveur.
  useEffect(() => {
    if (!actif) return;
    const marque = estNonLueRef.current;
    setNouvelles(new Set(alertes.filter((a) => (marque ? marque(a) : false)).map(signatureAlerte)));
    onMarquerLuRef.current?.();
  }, [actif, alertes]);

  const togglePush = useCallback(async () => {
    if (!supported || pushBusy) return;
    setPushBusy(true);
    setPushMessage(null);
    try {
      if (pushActive) {
        await disablePushNotifications();
        setPushActive(false);
      } else {
        const res = await enablePushNotifications();
        if (res?.ok) setPushActive(true);
        else if (res?.error === 'permission_denied') setPushMessage('Permission refusée par le navigateur.');
        else if (res?.error === 'not_configured') setPushMessage('Push non configuré côté serveur.');
        else if (res?.error === 'unsupported') setPushMessage('Navigateur non compatible.');
        else setPushMessage('Activation impossible.');
      }
    } catch (err) {
      setPushMessage(err?.message || 'Erreur activation push');
    }
    setPushBusy(false);
  }, [pushActive, pushBusy, supported]);

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {supported && (
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {pushActive ? (
              <BellRing className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            ) : (
              <BellOff className="w-4 h-4 text-slate-400 flex-shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-700">Notifications push</p>
              <p className="text-[11px] text-slate-500 truncate">
                {pushMessage || (pushActive ? 'Actives sur ce navigateur' : 'Désactivées')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={togglePush}
            disabled={pushBusy}
            className={`text-xs font-medium px-2.5 py-1 rounded-lg transition flex-shrink-0 ${
              pushActive
                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            } disabled:opacity-50`}
          >
            {pushBusy ? '…' : pushActive ? 'Désactiver' : 'Activer'}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
        {alertes.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-10 px-6">Aucune notification</p>
        ) : (
          alertes.map((alerte, i) => {
            const gravite = alerte.type || alerte.severite;
            const nouvelle = nouvelles.has(signatureAlerte(alerte));
            return (
              <div
                key={`${alerte.module || alerte.categorie || ''}-${i}`}
                className={`flex items-start gap-3 px-4 py-3 border-b border-slate-50 last:border-b-0 ${
                  gravite === 'error' ? 'bg-red-50/50' : gravite === 'warning' ? 'bg-amber-50/50' : ''
                }`}
              >
                <span className="flex-shrink-0 mt-0.5">
                  {gravite === 'warning' || gravite === 'error' ? (
                    <AlertTriangle className={`w-4 h-4 ${gravite === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
                  ) : (
                    <Info className="w-4 h-4 text-blue-500" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700 leading-snug break-words">{alerte.message}</p>
                  {/* Lien affiché UNIQUEMENT s'il est réellement fourni : les
                      alertes de /dashboard/kpis n'en portent pas aujourd'hui —
                      on n'en devine donc aucun. */}
                  {alerte.link && String(alerte.link).startsWith('/') && (
                    <Link
                      to={alerte.link}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary-dark hover:underline"
                    >
                      Ouvrir <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
                {nouvelle && (
                  <span className="flex-shrink-0 mt-0.5 text-[9.5px] font-bold uppercase tracking-wide text-red-600 bg-red-100 rounded-full px-1.5 py-0.5">
                    Nouveau
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
