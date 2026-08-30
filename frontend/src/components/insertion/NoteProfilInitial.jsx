import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { FREINS, frDate } from './freins';
import {
  exportNoteProfilPDF,
  NOTE_PROFIL_MENTION,
  NOTE_PROFIL_PCM_CHAPEAU_EST,
  NOTE_PROFIL_PCM_CHAPEAU_NEST_PAS,
  NOTE_PROFIL_PCM_CLOTURE,
} from './pdf-insertion';

/**
 * NOTE DE PROFIL INITIAL (analyse IA) — 2.43.0.
 *
 * Synthèse du dossier de recrutement (CV + entretien structuré + mises en
 * situation + profil PCM) remise à la CIP EN PRÉAMBULE du diagnostic d'accueil.
 *
 * Trois partis pris d'affichage, hérités du travail de recherche du chantier :
 *  1. La PAROLE DE LA PERSONNE est le premier bloc après la synthèse — c'est la
 *     seule section où elle est sujet et non objet d'analyse ; la placer après
 *     les freins et le PCM aurait inversé le rapport.
 *  2. Le bloc PCM est le DERNIER, dans un encadré distinct, avec un double
 *     chapeau (ce qu'il est / ce qu'il n'est pas) et une phrase de clôture qui
 *     redonne le dernier mot à l'expérience.
 *  3. La mention « analyse IA, hypothèses à vérifier » est PERMANENTE (pas un
 *     tooltip, pas un pied de page repliable) et le bloc « Sources et limites »
 *     NOMME les sources absentes — jamais de silence qui se lirait « rien à
 *     signaler ».
 *
 * Backend : GET /insertion/notes-profil/:employeeId (ADMIN/RH, journalisé),
 * POST /insertion/ia/note-profil/:employeeId, POST .../communiquer.
 * Le composant n'est monté que pour ADMIN/RH (les appelants gatent par rôle) —
 * le serveur refuse de toute façon en 403.
 */

// Les endpoints IA génèrent 2000-3500 tokens : délai dédié de 2 min (le timeout
// axios global est de 30 s ; nginx autorise 300 s sur /api).
const IA_TIMEOUT = 120000;

function formatIaError(err, fallback = 'Erreur de génération de la note') {
  if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
    return "La génération a dépassé le délai d'attente (le modèle met parfois 1 à 2 min). Réessayez.";
  }
  if (err.response?.status === 503) return err.response?.data?.error || 'Service IA non configuré (clé Anthropic absente).';
  const d = err.response?.data;
  return (d?.error || err.message || fallback) + (d?.hint ? ' — ' + d.hint : (d?.detail ? ' — ' + d.detail : ''));
}

const SOURCE_LABELS = {
  cv: 'CV', entretien: 'Entretien', mise_en_situation: 'Mise en situation', pcm: 'PCM',
};
const SOURCE_COLORS = {
  cv: 'bg-sky-100 text-sky-700 border-sky-200',
  entretien: 'bg-violet-100 text-violet-700 border-violet-200',
  mise_en_situation: 'bg-amber-100 text-amber-800 border-amber-200',
  pcm: 'bg-teal-100 text-teal-700 border-teal-200',
};

function Liste({ items, vide = 'Non renseigné.' }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="text-xs text-gray-400 italic">{vide}</p>;
  }
  return (
    <ul className="list-disc ml-5 space-y-1 text-sm text-gray-700">
      {items.map((x, i) => <li key={i}>{typeof x === 'string' ? x : JSON.stringify(x)}</li>)}
    </ul>
  );
}

export default function NoteProfilInitial({ employeeId, employee = {}, canGenerate = true, onDiagnostic = null }) {
  const [note, setNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get(`/insertion/notes-profil/${employeeId}`)
      .then((r) => { setNote(r.data?.note || null); setLoadError(null); })
      .catch((err) => setLoadError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  }, [employeeId]);
  useEffect(() => load(), [load]);

  const generer = async () => {
    setGenerating(true); setError(null);
    try {
      const r = await api.post(`/insertion/ia/note-profil/${employeeId}`, {}, { timeout: IA_TIMEOUT });
      setNote(r.data?.note || null);
    } catch (err) {
      setError(formatIaError(err));
    }
    setGenerating(false);
  };

  const prendreConnaissance = async () => {
    setMarking(true); setError(null);
    try {
      const r = await api.post(`/insertion/notes-profil/${employeeId}/communiquer`);
      setNote((n) => (n ? { ...n, communiquee_cip_at: r.data?.communiquee_cip_at || new Date().toISOString() } : n));
      if (onDiagnostic) onDiagnostic();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setMarking(false);
  };

  const c = note?.contenu || null;
  const sources = note?.sources || null;
  const sp = c?.structure_personnalite || null;
  const freins = Array.isArray(c?.freins_pressentis) ? c.freins_pressentis : [];
  const verbatims = Array.isArray(c?.expression_de_la_personne) ? c.expression_de_la_personne : [];
  const manques = Array.isArray(sources?.manques) ? sources.manques : [];
  const misesEnSituation = Array.isArray(sources?.has_mise_en_situation) ? sources.has_mise_en_situation : [];

  return (
    <div className="bg-white rounded-lg border border-teal-200">
      <div className="flex items-start justify-between gap-2 flex-wrap px-4 pt-3">
        <div>
          <h3 className="font-semibold text-gray-800">Note de profil initial (analyse IA)</h3>
          <p className="text-xs text-gray-500">
            Préambule du diagnostic d'accueil — synthèse du dossier de recrutement.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canGenerate && (
            <button type="button" onClick={generer} disabled={generating}
              className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50">
              {generating ? 'Génération en cours…' : (note ? 'Régénérer' : 'Générer la note')}
            </button>
          )}
          {note && c && (
            <button type="button" onClick={() => exportNoteProfilPDF({ employee, note })}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Export PDF
            </button>
          )}
        </div>
      </div>

      {/* Mention PERMANENTE — jamais repliable, jamais en pied de page. */}
      <div className="mx-4 mt-3 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
        {NOTE_PROFIL_MENTION}
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>
        )}
        {loadError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
            Note indisponible : {loadError}
          </div>
        )}
        {loading && <p className="text-xs text-gray-400">Chargement de la note…</p>}

        {!loading && !note && !loadError && (
          <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p>Aucune note de profil pour ce parcours.</p>
            <p className="text-xs text-gray-400 mt-1">
              Elle est normalement générée à la liaison de la fiche de recrutement. Si le collaborateur
              n'est lié à aucun candidat, il n'y a pas de dossier de recrutement à analyser.
            </p>
          </div>
        )}

        {!loading && note && note.contenu_illisible && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
            Le contenu de la note n'a pas pu être déchiffré (clé de chiffrement modifiée ou valeur
            corrompue). Régénérez la note.
          </div>
        )}

        {!loading && c && (
          <>
            {c._raw && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Le modèle n'a pas renvoyé une note structurée — texte brut ci-dessous.
                <pre className="mt-2 whitespace-pre-wrap font-sans text-gray-700">{c._raw}</pre>
              </div>
            )}

            {c.synthese && (
              <section>
                <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Synthèse</h4>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.synthese}</p>
              </section>
            )}

            {/* 1er bloc après la synthèse : la parole de la personne. */}
            <section>
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
                Ce que la personne dit d'elle-même
              </h4>
              {verbatims.length > 0 ? (
                <div className="space-y-1 border-l-4 border-teal-300 pl-3">
                  {verbatims.map((v, i) => (
                    <p key={i} className="text-sm text-gray-800 italic">« {v} »</p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">
                  Aucun verbatim disponible — l'entretien de recrutement structuré n'a pas été renseigné.
                </p>
              )}
            </section>

            <section>
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
                Freins pressentis — suggestions à confirmer au diagnostic
              </h4>
              {freins.length > 0 ? (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 border-b">
                          <th className="py-1 pr-2">Frein</th>
                          <th className="py-1 pr-2">Niveau suggéré</th>
                          <th className="py-1 pr-2">Provenance</th>
                          <th className="py-1">Élément du dossier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {freins.map((f, i) => {
                          const def = FREINS.find((x) => x.key === f.frein);
                          return (
                            <tr key={i} className="border-b border-gray-100 align-top">
                              <td className="py-1.5 pr-2 font-medium text-gray-800">{def ? def.label : f.frein}</td>
                              <td className="py-1.5 pr-2 text-gray-700">
                                {f.niveau_suggere == null
                                  ? <span className="text-gray-400 italic">non évaluable</span>
                                  : `${f.niveau_suggere}/5`}
                              </td>
                              <td className="py-1.5 pr-2">
                                {f.source ? (
                                  <span className={`inline-block px-2 py-0.5 rounded border text-xs ${SOURCE_COLORS[f.source] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                    {SOURCE_LABELS[f.source] || f.source}
                                  </span>
                                ) : <span className="text-gray-400 text-xs">—</span>}
                              </td>
                              <td className="py-1.5 text-gray-600 text-xs">{f.justification || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Ces niveaux ne sont pas enregistrés : vous les confirmez ou les corrigez vous-même au diagnostic.
                  </p>
                </>
              ) : (
                <p className="text-xs text-gray-400 italic">
                  Aucun frein pressenti à partir des éléments disponibles.
                </p>
              )}
            </section>

            <section>
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Compétences observées</h4>
              <Liste items={c.competences_observees} vide="Aucune compétence relevée dans le dossier." />
            </section>

            <section>
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
                Points de vigilance pour l'entretien
              </h4>
              <Liste items={c.points_vigilance_entretien} vide="Aucun point de vigilance identifié." />
            </section>

            <section>
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
                Questions suggérées pour le diagnostic
              </h4>
              <Liste items={c.questions_suggerees_diagnostic} vide="Aucune question suggérée." />
            </section>

            {/* Bloc PCM EN DERNIER, encadré, doublement chapeauté. */}
            <section className="rounded-lg border-2 border-teal-300 bg-teal-50 p-3">
              <h4 className="font-semibold text-teal-900 mb-2">Repères de communication (PCM)</h4>
              <p className="text-xs text-teal-900 font-medium">{NOTE_PROFIL_PCM_CHAPEAU_EST}</p>
              <p className="text-xs text-teal-800 mb-3">{NOTE_PROFIL_PCM_CHAPEAU_NEST_PAS}</p>
              {sp ? (
                <div className="space-y-2 text-sm text-gray-800">
                  {sp.canaux_communication && (
                    <p><span className="font-medium">Canal de communication : </span>{sp.canaux_communication}</p>
                  )}
                  {sp.besoins_psychologiques && (
                    <p><span className="font-medium">Ce à quoi la personne attache de l'importance : </span>{sp.besoins_psychologiques}</p>
                  )}
                  {Array.isArray(sp.points_forts) && sp.points_forts.length > 0 && (
                    <div>
                      <p className="font-medium text-sm">Appuis observés</p>
                      <Liste items={sp.points_forts} />
                    </div>
                  )}
                  {Array.isArray(sp.signaux_stress_a_observer) && sp.signaux_stress_a_observer.length > 0 && (
                    <div>
                      <p className="font-medium text-sm">Signaux à observer, et ce qui aide alors</p>
                      <Liste items={sp.signaux_stress_a_observer} />
                    </div>
                  )}
                  {Array.isArray(sp.conseils_posture_cip) && sp.conseils_posture_cip.length > 0 && (
                    <div>
                      <p className="font-medium text-sm">Posture d'entretien</p>
                      <Liste items={sp.conseils_posture_cip} />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-500 italic">
                  Aucun questionnaire PCM disponible pour cette personne.
                </p>
              )}
              <p className="text-xs text-teal-900 italic mt-3">{NOTE_PROFIL_PCM_CLOTURE}</p>
            </section>

            {/* Sources et limites — les manques sont NOMMÉS. */}
            <section className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">Sources et limites</h4>
              {sources ? (
                <ul className="text-xs text-gray-600 space-y-0.5">
                  <li>CV : {sources.has_cv ? 'exploité' : 'absent'}</li>
                  <li>Entretien structuré : {sources.has_interview_form ? 'exploité' : 'absent'}</li>
                  <li>Commentaire libre d'entretien : {sources.has_interview_comment ? 'exploité' : 'absent'}</li>
                  <li>Mises en situation : {misesEnSituation.length ? misesEnSituation.join(', ') : 'aucune'}</li>
                  <li>Profil PCM : {sources.has_pcm ? 'exploité' : 'absent'}</li>
                </ul>
              ) : (
                <p className="text-xs text-gray-400 italic">Traçabilité des sources non disponible pour cette note.</p>
              )}
              {manques.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-gray-700">Ce que cette note ne permet pas de dire :</p>
                  <ul className="list-disc ml-5 text-xs text-gray-600">
                    {manques.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </div>
              )}
              {c.limites && <p className="text-xs text-gray-600 mt-2">{c.limites}</p>}
              <p className="text-xs text-gray-400 mt-2">
                Générée le {frDate(note.generated_at)}
                {note.generated_by_name ? ` par ${note.generated_by_name}` : ' (génération automatique)'}
                {note.modele ? ` · modèle ${note.modele}` : ''}
              </p>
            </section>

            {/* Prise de connaissance explicite (jamais un simple affichage). */}
            <div className="flex items-center justify-between gap-2 flex-wrap border-t pt-3">
              {note.communiquee_cip_at ? (
                <p className="text-xs text-green-700">
                  Prise de connaissance enregistrée le {frDate(note.communiquee_cip_at)}
                  {note.communiquee_cip_by_name ? ` par ${note.communiquee_cip_by_name}` : ''}.
                </p>
              ) : (
                <p className="text-xs text-gray-500">
                  Cette note se lit avant le premier entretien.
                </p>
              )}
              {canGenerate && (
                <button type="button" onClick={prendreConnaissance} disabled={marking}
                  className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50">
                  {marking ? 'Enregistrement…' : "J'en ai pris connaissance — préparer le diagnostic"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
