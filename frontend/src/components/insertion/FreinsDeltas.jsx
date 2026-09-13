import { useMemo } from 'react';

/**
 * Évolution des freins : diagnostic d'entrée → dernière évaluation
 * (PR C lot 5, contrat § 5.4 — amendement CIP : les freins passent AVANT la
 * note de profil dans l'onglet Situation).
 *
 * ═══ POURQUOI UN TABLEAU À CÔTÉ DU RADAR ══════════════════════════════════
 * La toile d'araignée montre une FORME ; elle ne répond pas à la question que
 * la CIP pose en préparant un bilan : « qu'est-ce qui a bougé depuis l'entrée,
 * et dans quel sens ? ». Sur neuf axes et cinq séries, l'œil ne lit pas un
 * écart de 1. Le tableau le dit en toutes lettres.
 *
 * ═══ CE QU'IL NE DIT JAMAIS ═══════════════════════════════════════════════
 *  - Un axe NON ÉVALUÉ d'un côté ou de l'autre n'a pas de delta : il affiche
 *    « non comparable ». Compter une absence pour un zéro transformerait un
 *    sujet non abordé en frein levé — c'est le contraire d'un progrès.
 *  - L'axe judiciaire n'apparaît pas pour un encadrant : le serveur ne le lui
 *    envoie pas (`GET /milestones/:id/radar` retire l'axe pour un MANAGER), le
 *    composant n'a donc rien à masquer — il affiche ce qu'il reçoit.
 */

const BADGES = {
  leve: { libelle: 'levé', classe: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  ameliore: { libelle: 'en baisse', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  stable: { libelle: 'stable', classe: 'bg-slate-100 text-slate-600 border-slate-200' },
  aggrave: { libelle: 'aggravé', classe: 'bg-red-100 text-red-700 border-red-200' },
  incomparable: { libelle: 'non comparable', classe: 'bg-gray-50 text-gray-400 border-gray-200' },
};

function verdict(entree, actuel) {
  if (entree == null || actuel == null) return 'incomparable';
  if (actuel < entree) return actuel <= 1 ? 'leve' : 'ameliore';
  if (actuel > entree) return 'aggrave';
  return 'stable';
}

export default function FreinsDeltas({ data }) {
  const lignes = useMemo(() => {
    if (!data || !Array.isArray(data.axes) || !Array.isArray(data.series) || data.series.length === 0) return [];
    // Série d'ENTRÉE = le diagnostic initial s'il existe, sinon la plus
    // ancienne évaluation disponible — jamais une valeur inventée pour avoir
    // un point de départ.
    const entree = data.series[0];
    const actuel = data.series[data.series.length - 1];
    return data.axes.map((axe, i) => ({
      axe,
      entree: entree?.data?.[i] ?? null,
      actuel: actuel?.data?.[i] ?? null,
      verdict: verdict(entree?.data?.[i] ?? null, actuel?.data?.[i] ?? null),
    }));
  }, [data]);

  if (lignes.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        Aucune évaluation de freins pour l'instant — le tableau d'évolution apparaîtra dès le premier diagnostic.
      </p>
    );
  }

  const memeSerie = (data.series || []).length < 2;
  const evolues = lignes.filter((l) => l.verdict === 'leve' || l.verdict === 'ameliore').length;
  const aggraves = lignes.filter((l) => l.verdict === 'aggrave').length;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h4 className="text-sm font-semibold text-gray-700">
          Évolution depuis l'entrée
          <span className="font-normal text-gray-400 text-xs ml-2">
            {(data.series[0]?.label || 'entrée')} → {(data.series[data.series.length - 1]?.label || 'dernière évaluation')}
          </span>
        </h4>
        {!memeSerie && (
          <span className="text-[11px] text-gray-500">
            {evolues} axe(s) en baisse · {aggraves} en hausse
          </span>
        )}
      </div>

      {memeSerie && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
          Une seule évaluation enregistrée : il n'y a pas encore d'évolution à lire, seulement un point de départ.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1 pr-2 font-medium">Frein</th>
              <th className="py-1 px-2 font-medium">Entrée</th>
              <th className="py-1 px-2 font-medium">Aujourd'hui</th>
              <th className="py-1 pl-2 font-medium">Évolution</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const b = BADGES[l.verdict];
              return (
                <tr key={l.axe} className="border-t border-gray-100">
                  <td className="py-1.5 pr-2 text-gray-700">{l.axe}</td>
                  <td className="py-1.5 px-2 text-gray-500">{l.entree == null ? '—' : `${l.entree}/5`}</td>
                  <td className="py-1.5 px-2 font-medium text-gray-800">{l.actuel == null ? '—' : `${l.actuel}/5`}</td>
                  <td className="py-1.5 pl-2">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${b.classe}`}>{b.libelle}</span>
                    {l.entree != null && l.actuel != null && l.entree !== l.actuel && (
                      <span className="text-[11px] text-gray-400 ml-1.5">
                        {l.actuel > l.entree ? '+' : ''}{l.actuel - l.entree}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400">
        « Non comparable » : le sujet n'a pas été évalué à l'une des deux dates. Une absence
        d'évaluation n'est jamais comptée comme un frein levé.
      </p>
    </div>
  );
}
