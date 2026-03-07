import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const URGENCY_COLORS = {
  critique: 'bg-red-100 text-red-700 border-red-200',
  attention: 'bg-yellow-100 text-yellow-700 border-yellow-200',
};

const PHASE_COLORS = {
  en_cours: 'bg-blue-500',
  a_planifier: 'bg-gray-300',
  objectif: 'bg-green-400',
};

const PRIORITY_COLORS = {
  haute: 'bg-red-100 text-red-700',
  moyenne: 'bg-yellow-100 text-yellow-700',
  normale: 'bg-gray-100 text-gray-600',
};

export default function InsertionParcours() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => { loadEmployees(); }, []);

  const loadEmployees = async () => {
    try {
      const res = await api.get('/insertion');
      setEmployees(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const analyze = async (emp) => {
    setSelectedEmp(emp);
    setAnalyzing(true);
    try {
      const res = await api.get(`/insertion/${emp.id}`);
      setAnalysis(res.data);
    } catch (err) { console.error(err); }
    setAnalyzing(false);
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Parcours d'insertion</h1>
            <p className="text-gray-500">Analyse IA du parcours et de l'adéquation de chaque collaborateur</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-600 rounded text-xs font-medium">Critique</span>
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-50 text-yellow-600 rounded text-xs font-medium">Attention</span>
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-600 rounded text-xs font-medium">OK</span>
          </div>
        </div>

        <div className="flex gap-6">
          {/* Employee list */}
          <div className="w-80 flex-shrink-0">
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="p-3 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Collaborateurs actifs ({employees.length})
              </div>
              <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
                {employees.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => analyze(emp)}
                    className={`w-full text-left p-3 border-b hover:bg-gray-50 transition ${selectedEmp?.id === emp.id ? 'bg-violet-50 border-l-4 border-l-violet-500' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{emp.first_name} {emp.last_name}</p>
                        <p className="text-xs text-gray-400">{emp.team_name || 'Sans équipe'} — {emp.position || 'Poste non défini'}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {emp.has_pcm && (
                          <span className="w-2 h-2 rounded-full bg-violet-400" title="PCM disponible" />
                        )}
                        {emp.urgency && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${URGENCY_COLORS[emp.urgency]}`}>
                            {emp.urgency === 'critique' ? 'FIN' : 'BIENTÔT'}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                {employees.length === 0 && (
                  <div className="p-6 text-center text-gray-400 text-sm">Aucun collaborateur actif</div>
                )}
              </div>
            </div>
          </div>

          {/* Analysis panel */}
          <div className="flex-1 min-w-0">
            {!selectedEmp ? (
              <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
                <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 00-7-7z" />
                    <path strokeLinecap="round" strokeWidth={1.5} d="M9 21h6" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Moteur IA d'insertion</h3>
                <p className="text-gray-400 text-sm max-w-md mx-auto">
                  Sélectionnez un collaborateur pour obtenir une analyse complète de son parcours d'insertion,
                  de l'adéquation poste/personne et des recommandations personnalisées.
                </p>
              </div>
            ) : analyzing ? (
              <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-500 mx-auto mb-4" />
                <p className="text-gray-500">Analyse en cours de {selectedEmp.first_name} {selectedEmp.last_name}...</p>
              </div>
            ) : analysis && (
              <div className="space-y-4">
                {/* Header */}
                <div className="bg-white rounded-xl shadow-sm border p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-solidata-dark">
                        {analysis.employee.first_name} {analysis.employee.last_name}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {analysis.employee.team_name || 'Sans équipe'} — {analysis.employee.position || 'Poste non défini'}
                        {analysis.nb_contracts > 0 && ` — ${analysis.nb_contracts} contrat${analysis.nb_contracts > 1 ? 's' : ''}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <DataBadge label="PCM" available={analysis.has_pcm} />
                      <DataBadge label="CV" available={analysis.has_cv} />
                      <DataBadge label="Entretien" available={analysis.has_interview} />
                    </div>
                  </div>
                  {analysis.confiance < 0.5 && (
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      Confiance de l'analyse : {Math.round(analysis.confiance * 100)}%. Plus de données (PCM, CV, entretien) amélioreront la précision des recommandations.
                    </div>
                  )}
                </div>

                {/* Profil synthèse */}
                {analysis.profil_synthese && (
                  <Section title="Profil de la personne" icon="user" color="violet">
                    <div className="prose prose-sm max-w-none text-gray-600 whitespace-pre-line">
                      {formatMarkdownLight(analysis.profil_synthese)}
                    </div>
                  </Section>
                )}

                {/* Adéquation poste */}
                {analysis.adequation_poste && (
                  <Section title="Adéquation poste / personne" icon="briefcase" color="blue">
                    {analysis.adequation_poste.score !== null ? (
                      <div>
                        <div className="flex items-center gap-4 mb-4">
                          <ScoreGauge score={analysis.adequation_poste.score} />
                          <div>
                            <p className="text-lg font-semibold">{analysis.adequation_poste.niveau}</p>
                            <p className="text-sm text-gray-500">{analysis.adequation_poste.poste}</p>
                            {analysis.adequation_poste.description && (
                              <p className="text-xs text-gray-400 mt-1">{analysis.adequation_poste.description}</p>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-600 mb-3">{analysis.adequation_poste.commentaire}</p>
                        {analysis.adequation_poste.qualites_requises && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {analysis.adequation_poste.qualites_requises.map(q => (
                              <span key={q} className={`px-2 py-1 rounded text-xs font-medium ${
                                analysis.adequation_poste.qualites_matchees?.includes(q)
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}>{q}</span>
                            ))}
                          </div>
                        )}
                        {analysis.adequation_poste.evolution && (
                          <p className="text-xs text-gray-400">
                            Potentiel d'évolution : {analysis.adequation_poste.evolution}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">{analysis.adequation_poste.commentaire}</p>
                    )}
                  </Section>
                )}

                {/* Adéquation équipe */}
                {analysis.adequation_equipe && (
                  <Section title="Adéquation équipe / vie collective" icon="team" color="teal">
                    {analysis.adequation_equipe.score !== null ? (
                      <div>
                        <div className="flex items-center gap-4 mb-3">
                          <ScoreGauge score={analysis.adequation_equipe.score} />
                          <div>
                            <p className="text-lg font-semibold">{analysis.adequation_equipe.niveau}</p>
                            <p className="text-xs text-gray-400">{analysis.adequation_equipe.nb_collegues_analyses} profils analysés dans l'équipe</p>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">{analysis.adequation_equipe.commentaire}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">{analysis.adequation_equipe.commentaire}</p>
                    )}
                  </Section>
                )}

                {/* Risques */}
                {analysis.risques.length > 0 && (
                  <Section title="Points de vigilance" icon="alert" color="red">
                    <div className="space-y-2">
                      {analysis.risques.map((r, i) => (
                        <div key={i} className={`p-3 rounded-lg border ${r.niveau === 'critique' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                          <p className={`text-sm font-semibold ${r.niveau === 'critique' ? 'text-red-700' : 'text-amber-700'}`}>
                            {r.titre}
                          </p>
                          <p className={`text-xs mt-1 ${r.niveau === 'critique' ? 'text-red-600' : 'text-amber-600'}`}>
                            {r.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Parcours d'insertion */}
                {analysis.parcours_insertion && (
                  <Section title="Parcours d'insertion" icon="path" color="emerald">
                    <div className="relative">
                      {analysis.parcours_insertion.map((phase, idx) => (
                        <div key={idx} className="flex gap-4 mb-6 last:mb-0">
                          <div className="flex flex-col items-center">
                            <div className={`w-4 h-4 rounded-full ${PHASE_COLORS[phase.statut]} flex-shrink-0 mt-1`} />
                            {idx < analysis.parcours_insertion.length - 1 && (
                              <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
                            )}
                          </div>
                          <div className="flex-1 pb-2">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-semibold text-gray-800">{phase.phase}</h4>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                phase.statut === 'en_cours' ? 'bg-blue-100 text-blue-600' :
                                phase.statut === 'a_planifier' ? 'bg-gray-100 text-gray-500' :
                                'bg-green-100 text-green-600'
                              }`}>
                                {phase.statut === 'en_cours' ? 'En cours' : phase.statut === 'a_planifier' ? 'A planifier' : 'Objectif'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">{phase.description}</p>
                            <ul className="mt-2 space-y-1">
                              {phase.actions.map((a, j) => (
                                <li key={j} className="text-xs text-gray-600 flex items-start gap-2">
                                  <span className="text-gray-300 mt-0.5">-</span>
                                  <span>{a}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Recommandations managériales */}
                {analysis.recommandations.length > 0 && (
                  <Section title="Recommandations managériales" icon="tips" color="amber">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysis.recommandations.map((rec, i) => (
                        <div key={i} className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                          <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">{rec.titre}</p>
                          <p className="text-sm text-gray-600">{rec.detail}</p>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Plan d'action */}
                {analysis.plan_action.length > 0 && (
                  <Section title="Plan d'action" icon="check" color="indigo">
                    <div className="space-y-2">
                      {analysis.plan_action.map((action, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${PRIORITY_COLORS[action.priorite]}`}>
                            {action.priorite.toUpperCase()}
                          </span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-800">{action.action}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{action.detail}</p>
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">{action.echeance}</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function DataBadge({ label, available }) {
  return (
    <span className={`px-2 py-1 rounded-full text-[10px] font-medium ${
      available ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
    }`}>
      {available ? '\u2713' : '\u2717'} {label}
    </span>
  );
}

function ScoreGauge({ score }) {
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  const circumference = 2 * Math.PI * 32;
  const dashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="32" fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle cx="36" cy="36" r="32" fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={dashoffset}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold" style={{ color }}>{score}%</span>
      </div>
    </div>
  );
}

function Section({ title, color, children }) {
  const colorClasses = {
    violet: 'border-l-violet-500',
    blue: 'border-l-blue-500',
    teal: 'border-l-teal-500',
    red: 'border-l-red-500',
    emerald: 'border-l-emerald-500',
    amber: 'border-l-amber-500',
    indigo: 'border-l-indigo-500',
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-l-4 ${colorClasses[color] || ''} p-5`}>
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}

function formatMarkdownLight(text) {
  // Simple bold handling
  return text.split('\n').map((line, i) => {
    const parts = line.split(/\*\*(.*?)\*\*/g);
    return (
      <span key={i}>
        {parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part)}
        {i < text.split('\n').length - 1 && <br />}
      </span>
    );
  });
}
