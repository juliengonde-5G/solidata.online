import { Paperclip, Target } from 'lucide-react';
import { CHAPITRE_LABELS, NIVEAU_LABELS, NIVEAUX, niveauCellClasses } from './rseShared';

/**
 * Heatmap des 27 critères groupés par chapitre. Chaque cellule = un critère,
 * en-tête coloré selon le niveau auto-évalué (gris = non coté, dégradé 1→4),
 * corps blanc avec intitulé, niveau visé, pastilles (preuves, périmées en
 * rouge, actions en retard). Clic → modale de cotation (onSelect).
 */
export default function HeatmapCriteres({ criteres = [], onSelect }) {
  const byCh = {};
  for (const c of criteres) (byCh[c.chapitre] = byCh[c.chapitre] || []).push(c);
  const chapitres = Object.keys(byCh).sort();

  return (
    <div className="space-y-5">
      {/* Légende */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Niveau auto-évalué :</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-4 rounded border bg-gray-100 border-gray-200" /> Non coté
        </span>
        {NIVEAUX.map((n) => (
          <span key={n} className="inline-flex items-center gap-1.5">
            <span className={`w-4 h-4 rounded border ${niveauCellClasses(n)}`} /> {n} · {NIVEAU_LABELS[n]}
          </span>
        ))}
      </div>

      {chapitres.map((ch) => (
        <div key={ch}>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            <span className="text-slate-400 font-normal">Chapitre {ch} —</span> {CHAPITRE_LABELS[ch]}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {byCh[ch].map((c) => {
              const n = c.niveau_auto_evalue;
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => onSelect?.(c.code)}
                  className="text-left rounded-lg border border-slate-200 bg-white overflow-hidden hover:shadow-sm hover:border-slate-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
                  title={`Coter le critère ${c.code}`}
                >
                  <div className={`px-2 py-1.5 flex items-center justify-between border-b ${niveauCellClasses(n)}`}>
                    <span className="font-bold text-sm">{c.code}</span>
                    <span className="text-[11px] font-semibold">{n != null ? NIVEAU_LABELS[n] : 'non coté'}</span>
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] text-slate-600 leading-tight line-clamp-2 min-h-[2rem]">{c.intitule}</div>
                    <div className="mt-1.5 flex items-center justify-between gap-1 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        <Target className="w-3 h-3" aria-hidden="true" />
                        Visé : {c.niveau_vise != null ? c.niveau_vise : '—'}
                      </span>
                      {c.pilote_nom && (
                        <span className="text-[9px] text-slate-400 truncate max-w-[90px]" title={`Pilote : ${c.pilote_nom}`}>{c.pilote_nom}</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 flex-wrap">
                      <span className="inline-flex items-center gap-0.5" title="Preuves fraîches / total">
                        <Paperclip className="w-3 h-3" aria-hidden="true" />
                        {c.nb_preuves_fraiches ?? 0}/{c.nb_preuves ?? 0}
                      </span>
                      {c.nb_preuves_perimees > 0 && (
                        <span className="text-red-600 font-semibold" title="Preuves périmées">⚠ {c.nb_preuves_perimees} périmée{c.nb_preuves_perimees > 1 ? 's' : ''}</span>
                      )}
                      {c.nb_actions_en_retard > 0 && (
                        <span className="text-orange-600 font-semibold" title="Actions en retard">{c.nb_actions_en_retard} en retard</span>
                      )}
                      {c.nb_actions_en_cours > 0 && c.nb_actions_en_retard === 0 && (
                        <span className="text-slate-400" title="Actions en cours">{c.nb_actions_en_cours} action{c.nb_actions_en_cours > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {criteres.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">Référentiel non chargé.</p>
      )}
    </div>
  );
}
