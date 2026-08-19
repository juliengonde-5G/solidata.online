import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Clock, Ban, UserCog, Wrench, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState } from '../../components';
import { apiErr, fmtDateParis, employeeName, offsetDaysISO, todayISO, ORPHELIN_RAISON_LABELS } from './badgeuseShared';

// Types d'anomalies RÉELLEMENT émis par le moteur (services/badgeuse-engine.js :
// `pairEvents`, `computeDay`, `detectAnomalies`). Cette table était désalignée :
// elle attendait `journee_max` et `hors_plage`, deux clés que le serveur
// n'émet JAMAIS — les deux cartes correspondantes affichaient donc un « 0 »
// permanent (une journée de 12 h existait, la carte disait zéro), tandis que
// quatre types réels n'avaient aucun libellé et s'affichaient en clé technique
// (« sortie_sans_entree ») dans une interface censée être en français.
// Le serveur signale le hors-plage comme un ORPHELIN dont le `detail` vaut
// `hors_plage` : il se compte donc sur le détail, pas sur le type.
const TYPE_META = {
  oubli_sortie: { label: 'Oubli de sortie', icon: Clock, tone: 'amber' },
  journee_longue: { label: 'Journée > seuil', icon: AlertTriangle, tone: 'red' },
  sortie_sans_entree: { label: 'Sortie sans entrée', icon: AlertTriangle, tone: 'red' },
  sequence_impaire: { label: 'Entrée sans sortie précédente', icon: AlertTriangle, tone: 'amber' },
  sens_indetermine: { label: 'Sens à trancher', icon: AlertTriangle, tone: 'amber' },
  double_pointage: { label: 'Double pointage (rebond)', icon: Clock, tone: 'slate' },
  pointages_incomplets: { label: 'Pointages incomplets', icon: Wrench, tone: 'amber' },
  orphelin: { label: 'Badge orphelin', icon: UserCog, tone: 'slate' },
};

// Cartes de synthèse : cinq familles, toutes réellement alimentées. « Hors
// plage » est un sous-ensemble des orphelins (compté sur le détail) — il garde
// sa carte parce que c'est le signal d'un poste dont l'horloge dérive ou d'une
// plage mal réglée, que l'exploitant doit voir tout de suite.
const CARTES = [
  { cle: 'oubli_sortie', label: 'Oubli de sortie', icon: Clock, tone: 'amber' },
  { cle: 'journee_longue', label: 'Journée > seuil', icon: AlertTriangle, tone: 'red' },
  { cle: 'pointages_incomplets', label: 'Pointages incomplets', icon: Wrench, tone: 'amber' },
  { cle: 'hors_plage', label: 'Pointage hors plage', icon: Ban, tone: 'red', detail: 'hors_plage', type: 'orphelin' },
  { cle: 'orphelin', label: 'Badge orphelin', icon: UserCog, tone: 'slate' },
];
const TONE_CLASSES = {
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  red: 'bg-red-50 text-red-700 border-red-100',
  slate: 'bg-slate-50 text-slate-700 border-slate-100',
};

function metaFor(type) { return TYPE_META[type] || { label: type || 'Anomalie', icon: AlertTriangle, tone: 'slate' }; }

// Onglet « Anomalies » (BO-05). Fenêtre du/au, cartes de synthèse par type,
// tableau détaillé, lien vers une correction pré-remplie dans le Journal.
export default function AnomaliesBadgeuse({ onCorrigerAnomalie }) {
  const [du, setDu] = useState(offsetDaysISO(-7));
  const [au, setAu] = useState(todayISO());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/badgeuse/anomalies?du=${du}&au=${au}`)
      .then((r) => { setData(r.data); setError(null); })
      .catch((err) => setError(apiErr(err, 'Chargement des anomalies impossible.')))
      .finally(() => setLoading(false));
  }, [du, au]);
  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState variant="card" title="Anomalies indisponibles" message={error} onRetry={load} />;

  const synthese = data?.synthese || data?.totaux || {};
  const anomalies = Array.isArray(data?.anomalies) ? data.anomalies
    : (Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));

  // Compte d'une carte — préfère la synthèse serveur si elle porte la clé,
  // sinon dérive de la liste (par type, ou par type + détail pour le hors-plage).
  const countFor = (carte) => {
    if (synthese[carte.cle] != null) return synthese[carte.cle];
    const type = carte.type || carte.cle;
    return anomalies.filter(
      (a) => a.type === type && (!carte.detail || a.detail === carte.detail)
    ).length;
  };

  return (
    <div className="space-y-5">
      {/* Filtres */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="an-du" className="block text-xs font-medium text-slate-600 mb-1">Du</label>
          <input id="an-du" type="date" value={du} onChange={(e) => setDu(e.target.value)} className="input-modern py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="an-au" className="block text-xs font-medium text-slate-600 mb-1">Au</label>
          <input id="an-au" type="date" value={au} onChange={(e) => setAu(e.target.value)} className="input-modern py-2 text-sm" />
        </div>
        <div className="flex-1" />
        <button onClick={load} className="text-xs text-slate-400 hover:text-teal-700 inline-flex items-center gap-1 mb-2" title="Actualiser">
          <RefreshCw className="w-3.5 h-3.5" /> Actualiser
        </button>
      </div>

      {loading ? <LoadingSpinner size="lg" message="Chargement des anomalies…" /> : (
        <>
          {/* Cartes de synthèse par type */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {CARTES.map((carte) => {
              const Icon = carte.icon;
              return (
                <div key={carte.cle} className={`rounded-xl border p-4 ${TONE_CLASSES[carte.tone]}`}>
                  <div className="flex items-center gap-2 text-xs font-medium opacity-80"><Icon className="w-4 h-4" />{carte.label}</div>
                  <div className="mt-1 text-2xl font-bold">{countFor(carte)}</div>
                </div>
              );
            })}
          </div>

          {/* Tableau détaillé */}
          <div className="bg-white rounded-xl border p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Détail des anomalies ({du} → {au})</h3>
            {anomalies.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">Aucune anomalie détectée sur cette période.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-2 px-2">Type</th>
                      <th className="text-left py-2 px-2">Salarié</th>
                      <th className="text-left py-2 px-2">Date</th>
                      <th className="text-left py-2 px-2">Détail</th>
                      <th className="text-right py-2 px-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {anomalies.map((a, i) => {
                      const meta = metaFor(a.type);
                      const Icon = meta.icon;
                      const date = a.date || (a.horodatage_utc ? fmtDateParis(a.horodatage_utc) : null);
                      return (
                        <tr key={a.id || i} className="border-b border-slate-50">
                          <td className="py-2 px-2">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${TONE_CLASSES[meta.tone]}`}>
                              <Icon className="w-3.5 h-3.5" /> {meta.label}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-slate-700">{a.employee_id != null ? employeeName(a) : <span className="text-slate-400">— (badge non rattaché)</span>}</td>
                          <td className="py-2 px-2 whitespace-nowrap text-slate-600">{date || '—'}</td>
                          {/* Le détail d'un orphelin est une RAISON codée
                              (`badge_inconnu`, `hors_plage`) : elle se lit en
                              français, jamais en clé technique. */}
                          <td className="py-2 px-2 text-slate-500">
                            {ORPHELIN_RAISON_LABELS[a.detail] || a.detail || a.message || a.description || '—'}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {a.type === 'orphelin' ? (
                              <button onClick={() => onCorrigerAnomalie?.()} className="text-xs font-medium text-teal-700 hover:text-teal-900 inline-flex items-center gap-1">
                                <UserCog className="w-3.5 h-3.5" /> Rattacher (Journal)
                              </button>
                            ) : a.employee_id != null && date ? (
                              <button onClick={() => onCorrigerAnomalie?.({ employee_id: a.employee_id, date })} className="text-xs font-medium text-teal-700 hover:text-teal-900 inline-flex items-center gap-1">
                                <Wrench className="w-3.5 h-3.5" /> Corriger
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
