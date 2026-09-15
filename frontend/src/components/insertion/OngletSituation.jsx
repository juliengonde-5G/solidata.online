import { useState } from 'react';
import api from '../../services/api';
import RadarFreins from './RadarFreins';
import FreinsDeltas from './FreinsDeltas';
import FriseParcours from './FriseParcours';
import ChecklistEmbauche from './ChecklistEmbauche';
import PmsmpPanel from './PmsmpPanel';
import SatisfactionForm from './SatisfactionForm';
import NoteProfilInitial from './NoteProfilInitial';
import DocumentsSalariePanel from './DocumentsSalariePanel';
import { FREIN_LEVEL_COLORS } from './freins';

/**
 * Onglet « Situation » de la fiche (PR C lot 5, contrat § 5.4).
 *
 * ═══ L'ORDRE EST UNE DÉCISION, PAS UNE MISE EN PAGE ═══════════════════════
 * Les FREINS viennent AVANT la note de profil (amendement CIP § 10). La note
 * de profil est une proposition d'un modèle, produite à l'entrée et figée ;
 * les freins sont ce que la CIP a constaté et réévalué. Mettre la proposition
 * en premier, c'est faire lire le portrait avant les faits.
 *
 * La frise est REPLIÉE : elle est utile pour raconter un parcours, elle ne
 * l'est pas pour préparer un entretien de la semaine. La check-list d'embauche
 * disparaît quand elle est complète — une liste entièrement cochée en tête de
 * fiche n'apprend plus rien.
 */

const IA_TIMEOUT = 120000;

function formatIaError(err, fallback = 'Erreur analyse IA') {
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
    return "L'analyse a dépassé le délai d'attente (le modèle met parfois 1 à 2 min). Réessayez.";
  }
  if (err.response?.status === 503) return err.response?.data?.error || 'Service IA non configuré (clé Anthropic absente).';
  const d = err.response?.data;
  return (d?.error || err.message || fallback) + (d?.hint ? ' — ' + d.hint : (d?.detail ? ' — ' + d.detail : ''));
}

/** Recommandations ALGORITHMIQUES (aucun modèle de langage). */
function RecommandationsAlgorithmiques({ recommendations }) {
  if (!recommendations) return null;
  const { alertes, propositions, accompagnement } = recommendations;
  const rien = !alertes?.length && !propositions?.length && !accompagnement?.length;
  if (rien) return null;
  return (
    <div className="space-y-3">
      {alertes?.length > 0 && (
        <div>
          <h4 className="font-semibold text-red-700 text-sm mb-2">Points d'attention</h4>
          {alertes.map((a, i) => (
            <div key={i} className={`p-2 rounded mb-1 text-sm ${a.urgence === 'haute' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
              <div className="font-medium">{a.message}</div>
              {a.actions_suggerees?.length > 0 && (
                <ul className="mt-1 text-xs text-gray-600 list-disc list-inside">
                  {a.actions_suggerees.map((s, j) => <li key={j}>{s}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {propositions?.length > 0 && (
        <div>
          <h4 className="font-semibold text-teal-700 text-sm mb-2">Propositions</h4>
          {propositions.map((p, i) => (
            <div key={i} className="p-2 rounded mb-1 text-sm bg-teal-50 border border-teal-200">
              <div className="font-medium">{p.message || p.action}</div>
              {p.detail && <div className="text-xs text-gray-600">{p.detail}</div>}
            </div>
          ))}
        </div>
      )}
      {accompagnement?.length > 0 && (
        <div>
          <h4 className="font-semibold text-slate-600 text-sm mb-2">Accompagnement</h4>
          <ul className="list-disc list-inside text-sm text-gray-700 space-y-0.5">
            {accompagnement.map((a, i) => <li key={i}>{typeof a === 'string' ? a : (a.message || a.action)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function OngletSituation({
  employeeId, employee, analysis, radarData, contracts, milestones,
  adminRh, onDiagnostic, onFriseSelect, onReload,
}) {
  const [ia, setIa] = useState(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState(null);
  const [friseOuverte, setFriseOuverte] = useState(false);

  const lancerSynthese = async () => {
    setIaLoading(true); setIaError(null);
    try {
      const r = await api.get(`/insertion/ia/profil/${employeeId}`, { timeout: IA_TIMEOUT });
      setIa(r.data);
    } catch (err) {
      setIaError(formatIaError(err));
    }
    setIaLoading(false);
  };

  const aUnBilanDeSortie = (milestones || []).some((m) => m.milestone_type === 'bilan_sortie' && m.status === 'realise');
  const freins = analysis?.freins_sociaux?.freins || [];

  return (
    <div className="space-y-4">
      {/* 1. Freins — le constat, avant toute proposition */}
      <section className="bg-white rounded-lg border p-4 space-y-4">
        <h3 className="font-semibold text-gray-800">Freins périphériques</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RadarFreins data={radarData} />
          <FreinsDeltas data={radarData} />
        </div>
        {freins.length > 0 && (
          <details className="border-t pt-3">
            <summary className="cursor-pointer select-none text-sm font-medium text-gray-600">
              Dernière évaluation, frein par frein
            </summary>
            <div className="space-y-2 mt-2">
              {freins.map((f) => (
                <div key={f.type} className="flex items-center gap-3 p-2 rounded bg-gray-50">
                  <span className="w-28 text-sm font-medium text-gray-700">{f.label}</span>
                  <div className="flex-1 bg-gray-200 rounded-full h-3">
                    <div className={`h-3 rounded-full ${
                      f.niveau <= 2 ? 'bg-green-500' : f.niveau === 3 ? 'bg-yellow-500' : f.niveau === 4 ? 'bg-orange-500' : 'bg-red-500'
                    }`} style={{ width: `${f.niveau * 20}%` }} />
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${FREIN_LEVEL_COLORS[f.niveau]}`}>{f.niveau}/5</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* 2. Note de profil initial — ADMIN/RH (le serveur la refuse aux autres) */}
      {adminRh && (
        <NoteProfilInitial
          employeeId={employeeId}
          employee={employee}
          canGenerate={adminRh}
          onDiagnostic={onDiagnostic}
        />
      )}

      {!analysis?.has_diagnostic && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 text-center">
          <p className="text-sm font-medium text-teal-800">Commencer le diagnostic d'accueil</p>
          <p className="text-xs text-teal-600 mt-1">
            Le socle se remplit en sept rubriques, avec sauvegarde automatique — possible en deux séances.
          </p>
          <button onClick={onDiagnostic}
            className="mt-2 px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700">
            Ouvrir le diagnostic
          </button>
        </div>
      )}

      {/* 3. Frise — repliée : utile pour raconter, pas pour préparer */}
      <section className="bg-white rounded-lg border p-4">
        <button type="button" onClick={() => setFriseOuverte((o) => !o)}
          className="flex items-center justify-between w-full text-left">
          <h3 className="font-semibold text-gray-800">Frise du parcours</h3>
          <span className="text-xs text-teal-700 underline">{friseOuverte ? 'Masquer' : 'Voir le détail'}</span>
        </button>
        {friseOuverte && (
          <div className="mt-3">
            <FriseParcours
              employee={employee}
              contracts={contracts}
              milestones={milestones}
              objectifs={analysis?.objectifs || []}
              pmsmp={analysis?.pmsmp || []}
              hasCandidate={!!analysis?.has_candidate_data}
              hasPcm={!!analysis?.has_pcm}
              onSelect={onFriseSelect}
            />
          </div>
        )}
      </section>

      {/* 4. Accueil / intégration — disparaît quand la check-list est complète */}
      <div className="bg-white rounded-lg border p-3">
        <ChecklistEmbauche employeeId={employeeId} canEdit={adminRh} />
      </div>

      {/* 5. Immersions */}
      <div className="bg-white rounded-lg border p-4">
        <PmsmpPanel employeeId={employeeId} canEdit={adminRh} />
      </div>

      {/* 6. Satisfaction de sortie — dès qu'une sortie existe */}
      {(analysis?.satisfaction || employee?.insertion_status === 'termine' || aUnBilanDeSortie) && (
        <div className="bg-white rounded-lg border p-4">
          <SatisfactionForm employeeId={employeeId} canEdit={adminRh} onSaved={onReload} />
        </div>
      )}

      {/* 7. Documents remis à la personne (lot 7) — ADMIN/RH */}
      {adminRh && (
        <div className="bg-white rounded-lg border p-4">
          <DocumentsSalariePanel employee={employee} />
        </div>
      )}

      {/* 8. Lectures assistées — algorithmique d'abord, modèle ensuite */}
      {analysis?.ai_recommendations && (
        <section className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-800 mb-3">Points relevés automatiquement</h3>
          <RecommandationsAlgorithmiques recommendations={analysis.ai_recommendations} />
        </section>
      )}

      {analysis?.pistes_metiers?.length > 0 && (
        <section className="bg-white rounded-lg border p-4">
          <h3 className="font-semibold text-gray-800 mb-2">Pistes métiers</h3>
          {analysis.pistes_metiers.slice(0, 3).map((p, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded bg-gray-50 mb-1">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: p.score >= 70 ? '#10B981' : p.score >= 50 ? '#F59E0B' : '#EF4444' }}>
                {p.score}%
              </div>
              <div className="min-w-0">
                <div className="font-medium text-sm">{p.metier}</div>
                <div className="text-xs text-gray-500">{p.pourquoi}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {adminRh && (
        <section className="bg-white rounded-lg border p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-800">Proposition de synthèse (IA)</h3>
            <button onClick={lancerSynthese} disabled={iaLoading}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-50">
              {iaLoading ? 'Analyse…' : 'Générer une proposition'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Une PROPOSITION, jamais une conclusion : elle se relit, se corrige, et ne remplace aucun
            constat de l'entretien. La préparation d'un entretien précis se lance depuis l'entretien
            lui-même (« Préparer avec l'IA »).
          </p>

          {iaError && (
            <div className="mb-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 flex items-start gap-2">
              <span aria-hidden="true">⚠</span><span>{iaError}</span>
            </div>
          )}

          {ia && (
            <div className="bg-violet-50 rounded-xl border border-violet-200 p-4 space-y-3">
              {ia.score_progression != null && (
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                  ia.score_progression >= 60 ? 'bg-emerald-100 text-emerald-700'
                    : ia.score_progression >= 30 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                }`}>Progression : {ia.score_progression}%</span>
              )}
              {ia.synthese && <p className="text-sm text-slate-700">{ia.synthese}</p>}
              {ia.pcm_adaptation && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Communication :</span> {ia.pcm_adaptation.communication}</div>
                  <div className="bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Management :</span> {ia.pcm_adaptation.management}</div>
                </div>
              )}
              {ia.risque_decrochage && (
                <div className={`text-xs rounded-lg p-2 border ${
                  ia.risque_decrochage.niveau === 'eleve' ? 'bg-red-50 border-red-200 text-red-700'
                    : ia.risque_decrochage.niveau === 'moyen' ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-green-50 border-green-200 text-green-700'
                }`}>
                  Risque de décrochage : <strong>{ia.risque_decrochage.niveau}</strong>
                  {ia.risque_decrochage.facteurs?.length > 0 && ` — ${ia.risque_decrochage.facteurs.join(', ')}`}
                </div>
              )}
              {ia.risque_decrochage?.signaux_alerte?.length > 0 && (
                <div className="text-xs text-red-700 bg-red-50 rounded-lg p-2 border border-red-200">
                  <span className="font-semibold">Signaux relevés :</span> {ia.risque_decrochage.signaux_alerte.join(' · ')}
                </div>
              )}
              {ia.freins_prioritaires?.length > 0 && (
                <div className="text-xs"><span className="font-semibold text-violet-700">Freins prioritaires :</span> {ia.freins_prioritaires.join(', ')}</div>
              )}
              {ia.pcm_adaptation?.vigilances && (
                <div className="text-xs bg-white rounded-lg p-2 border"><span className="font-semibold text-violet-700">Vigilances PCM :</span> {ia.pcm_adaptation.vigilances}</div>
              )}
              {ia.plan_action_propose?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-violet-700 mb-1">Plan d'action proposé</p>
                  <div className="space-y-1">
                    {ia.plan_action_propose.map((a, i) => (
                      <div key={i} className="text-xs bg-white rounded p-2 border flex justify-between gap-2">
                        <span>{a.action}</span><span className="text-gray-400">{a.echeance}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {ia.prochaine_etape && (
                <div className="text-xs bg-teal-50 rounded-lg p-2 border border-teal-200 text-teal-800">
                  <strong>Prochaine étape :</strong> {ia.prochaine_etape}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
