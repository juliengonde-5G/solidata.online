import { useState, useEffect, useCallback } from 'react';
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

const FREIN_COLORS = {
  1: 'bg-green-100 text-green-700',
  2: 'bg-green-50 text-green-600',
  3: 'bg-yellow-100 text-yellow-700',
  4: 'bg-orange-100 text-orange-700',
  5: 'bg-red-100 text-red-700',
};

const FREIN_ICONS = {
  mobilite: '\u{1F697}', sante: '\u{2764}\u{FE0F}', finances: '\u{1F4B0}',
  famille: '\u{1F46A}', linguistique: '\u{1F4AC}', administratif: '\u{1F4C4}', numerique: '\u{1F4BB}',
};

const PCM_QUESTIONS = [
  { key: 'pcm_q_travail_ideal', label: 'Le travail ideal', question: 'Decrivez votre journee de travail ideale. Qu\'est-ce qui vous rend content au travail ?' },
  { key: 'pcm_q_reaction_stress', label: 'Face au stress', question: 'Quand ca ne va pas au travail, que faites-vous ? Comment reagissez-vous ?' },
  { key: 'pcm_q_relation_equipe', label: 'En equipe', question: 'Preferez-vous travailler seul(e) ou en equipe ? Pourquoi ?' },
  { key: 'pcm_q_motivation', label: 'Motivation', question: 'Qu\'est-ce qui vous donne envie de venir travailler le matin ?' },
  { key: 'pcm_q_apprentissage', label: 'Apprentissage', question: 'Comment apprenez-vous le mieux ? (en regardant, en ecoutant, en faisant ?)' },
  { key: 'pcm_q_communication', label: 'Communication', question: 'Qu\'est-ce qui est important pour vous dans la facon dont on vous parle au travail ?' },
];

const FREINS_CONFIG = [
  {
    key: 'mobilite', label: 'Mobilite', question: 'Comment venez-vous au travail ?',
    causes: [
      { id: 'eloignement', label: 'Eloignement geographique (> 30 min)' },
      { id: 'pas_vehicule', label: 'Absence de vehicule personnel' },
      { id: 'pas_permis', label: 'Pas de permis de conduire' },
      { id: 'peur_conduite', label: 'Peur de la conduite / apprehension' },
      { id: 'transports_limites', label: 'Transports en commun limites ou inexistants' },
      { id: 'cout_transport', label: 'Cout du transport trop eleve' },
      { id: 'horaires_incompatibles', label: 'Horaires incompatibles avec les transports' },
    ],
  },
  {
    key: 'sante', label: 'Sante', question: 'Comment vous sentez-vous physiquement pour travailler ?',
    causes: [
      { id: 'douleurs_physiques', label: 'Douleurs physiques (dos, articulations...)' },
      { id: 'maladie_chronique', label: 'Maladie chronique ou traitement lourd' },
      { id: 'troubles_psy', label: 'Troubles psychologiques (anxiete, depression...)' },
      { id: 'addictions', label: 'Addictions (tabac, alcool, substances)' },
      { id: 'fatigue_chronique', label: 'Fatigue chronique / troubles du sommeil' },
      { id: 'handicap', label: 'Situation de handicap (RQTH ou en cours)' },
      { id: 'pas_suivi_medical', label: 'Pas de suivi medical regulier' },
    ],
  },
  {
    key: 'finances', label: 'Finances', question: 'Arrivez-vous a couvrir vos depenses courantes ?',
    causes: [
      { id: 'endettement', label: 'Endettement ou credits en cours' },
      { id: 'loyer_impaye', label: 'Loyer impaye ou menace d\'expulsion' },
      { id: 'pas_compte_bancaire', label: 'Pas de compte bancaire ou interdit bancaire' },
      { id: 'droits_non_ouverts', label: 'Droits sociaux non ouverts (RSA, APL, prime activite)' },
      { id: 'charges_elevees', label: 'Charges fixes trop elevees' },
      { id: 'precarite_alimentaire', label: 'Difficultes alimentaires / recours epicerie sociale' },
    ],
  },
  {
    key: 'famille', label: 'Famille', question: 'Avez-vous des contraintes familiales pour vos horaires ?',
    causes: [
      { id: 'parent_isole', label: 'Parent isole (seul avec enfant(s))' },
      { id: 'garde_enfants', label: 'Pas de solution de garde d\'enfants' },
      { id: 'proche_dependant', label: 'Proche dependant a charge (parent age, handicape)' },
      { id: 'conflit_familial', label: 'Conflit familial ou violence domestique' },
      { id: 'horaires_contraints', label: 'Horaires contraints par la vie familiale' },
      { id: 'isolement_social', label: 'Isolement social (pas de reseau familial ou amical)' },
    ],
  },
  {
    key: 'linguistique', label: 'Langue', question: 'Comprenez-vous bien le francais au travail ?',
    causes: [
      { id: 'oral_difficile', label: 'Difficulte a comprendre le francais oral' },
      { id: 'ecrit_difficile', label: 'Difficulte a lire et ecrire en francais' },
      { id: 'analphabete', label: 'Analphabetisme ou illettrisme' },
      { id: 'pas_formation_fle', label: 'Pas de formation FLE en cours' },
      { id: 'consignes_securite', label: 'Difficulte a comprendre les consignes de securite' },
      { id: 'honte', label: 'Honte ou peur de parler (frein psychologique)' },
    ],
  },
  {
    key: 'administratif', label: 'Administratif', question: 'Vos papiers et demarches sont-ils a jour ?',
    causes: [
      { id: 'titre_sejour', label: 'Titre de sejour en cours de renouvellement' },
      { id: 'sans_papiers', label: 'Situation irreguliere ou en attente de regularisation' },
      { id: 'demarches_complexes', label: 'Demarches administratives complexes en cours' },
      { id: 'pas_couverture_sante', label: 'Pas de couverture sante (mutuelle, CMU)' },
      { id: 'probleme_pole_emploi', label: 'Probleme avec Pole Emploi / France Travail' },
      { id: 'casier_judiciaire', label: 'Casier judiciaire (frein a l\'embauche)' },
    ],
  },
  {
    key: 'numerique', label: 'Numerique', question: 'Utilisez-vous un telephone ou un ordinateur facilement ?',
    causes: [
      { id: 'pas_smartphone', label: 'Pas de smartphone ou telephone basique' },
      { id: 'pas_internet', label: 'Pas d\'acces internet a domicile' },
      { id: 'pas_email', label: 'Pas d\'adresse email ou ne sait pas l\'utiliser' },
      { id: 'pas_demarches_ligne', label: 'Incapable de faire des demarches en ligne' },
      { id: 'peur_technologie', label: 'Peur ou rejet de la technologie' },
      { id: 'pas_formation', label: 'Jamais eu de formation numerique' },
    ],
  },
];

const FREIN_LEVELS = [
  { value: 1, label: 'Pas de difficulte', emoji: '\u{1F7E2}' },
  { value: 2, label: 'Legere difficulte', emoji: '\u{1F7E1}' },
  { value: 3, label: 'Difficulte moderee', emoji: '\u{1F7E0}' },
  { value: 4, label: 'Difficulte importante', emoji: '\u{1F534}' },
  { value: 5, label: 'Bloquant', emoji: '\u26D4' },
];

export default function InsertionParcours() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [diagnostic, setDiagnostic] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('analyse');
  const [diagTab, setDiagTab] = useState('freins');

  useEffect(() => { loadEmployees(); }, []);

  const loadEmployees = async () => {
    try {
      const res = await api.get('/insertion');
      setEmployees(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const selectEmployee = useCallback(async (emp) => {
    setSelectedEmp(emp);
    setAnalysis(null);
    setDiagnostic(null);
    setActiveTab('analyse');

    // Charger analyse et diagnostic en parallèle
    setAnalyzing(true);
    try {
      const [analysisRes, diagRes] = await Promise.all([
        api.get(`/insertion/${emp.id}`),
        api.get(`/insertion/diagnostic/${emp.id}`).catch(() => ({ data: null })),
      ]);
      setAnalysis(analysisRes.data);
      setDiagnostic(diagRes.data || createEmptyDiagnostic());
    } catch (err) {
      console.error(err);
      setDiagnostic(createEmptyDiagnostic());
    }
    setAnalyzing(false);
  }, []);

  const createEmptyDiagnostic = () => ({
    parcours_anterieur: '', contraintes_sante: '', contraintes_mobilite: '',
    contraintes_familiales: '', autres_contraintes: '',
    frein_mobilite: 1, frein_mobilite_detail: '', frein_mobilite_causes: '',
    frein_sante: 1, frein_sante_detail: '', frein_sante_causes: '',
    frein_finances: 1, frein_finances_detail: '', frein_finances_causes: '',
    frein_famille: 1, frein_famille_detail: '', frein_famille_causes: '',
    frein_linguistique: 1, frein_linguistique_detail: '', frein_linguistique_causes: '',
    frein_administratif: 1, frein_administratif_detail: '', frein_administratif_causes: '',
    frein_numerique: 1, frein_numerique_detail: '', frein_numerique_causes: '',
    pcm_q_travail_ideal: '', pcm_q_reaction_stress: '', pcm_q_relation_equipe: '',
    pcm_q_motivation: '', pcm_q_apprentissage: '', pcm_q_communication: '',
    obs_taches_realisees: '', obs_points_forts: '', obs_difficultes: '',
    obs_comportement_equipe: '', obs_autonomie_ponctualite: '',
    pref_aime_faire: '', pref_ne_veut_plus: '', pref_environnement_prefere: '',
    pref_environnement_eviter: '', pref_objectifs: '',
    explorama_interets: '', explorama_rejets: '',
    explorama_gestes_positifs: '', explorama_gestes_negatifs: '',
    explorama_environnements: '', explorama_rythme: '',
    cip_hypotheses_metiers: '', cip_questions: '',
  });

  const updateDiagnostic = (field, value) => {
    setDiagnostic(prev => ({ ...prev, [field]: value }));
  };

  const saveDiagnostic = async () => {
    if (!selectedEmp || !diagnostic) return;
    setSaving(true);
    try {
      await api.put(`/insertion/diagnostic/${selectedEmp.id}`, diagnostic);
      // Recharger l'analyse avec les nouvelles données
      const res = await api.get(`/insertion/${selectedEmp.id}`);
      setAnalysis(res.data);
      setActiveTab('analyse');
    } catch (err) {
      console.error(err);
      alert('Erreur lors de la sauvegarde');
    }
    setSaving(false);
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Parcours d'insertion</h1>
            <p className="text-gray-500">Outil CIP : diagnostic, analyse et parcours de chaque collaborateur</p>
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
                    onClick={() => selectEmployee(emp)}
                    className={`w-full text-left p-3 border-b hover:bg-gray-50 transition ${selectedEmp?.id === emp.id ? 'bg-violet-50 border-l-4 border-l-violet-500' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{emp.first_name} {emp.last_name}</p>
                        <p className="text-xs text-gray-400">{emp.team_name || 'Sans equipe'}  - {emp.position || 'Poste non defini'}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {emp.has_diagnostic && (
                          <span className="w-2 h-2 rounded-full bg-emerald-400" title="Diagnostic rempli" />
                        )}
                        {emp.has_pcm && (
                          <span className="w-2 h-2 rounded-full bg-violet-400" title="PCM disponible" />
                        )}
                        {emp.urgency && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${URGENCY_COLORS[emp.urgency]}`}>
                            {emp.urgency === 'critique' ? 'FIN' : 'BIENTOT'}
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

          {/* Main panel */}
          <div className="flex-1 min-w-0">
            {!selectedEmp ? (
              <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
                <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 00-7-7z" />
                    <path strokeLinecap="round" strokeWidth={1.5} d="M9 21h6" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Outil CIP  - Parcours d'insertion</h3>
                <p className="text-gray-400 text-sm max-w-md mx-auto">
                  Selectionnez un collaborateur pour acceder a son diagnostic, son questionnaire d'entretien,
                  et l'analyse IA de son parcours d'insertion.
                </p>
              </div>
            ) : analyzing ? (
              <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-500 mx-auto mb-4" />
                <p className="text-gray-500">Chargement de {selectedEmp.first_name} {selectedEmp.last_name}...</p>
              </div>
            ) : (
              <div>
                {/* Tabs */}
                <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
                  {[
                    { id: 'analyse', label: 'Analyse IA' },
                    { id: 'questionnaire', label: 'Questionnaire CIP' },
                    { id: 'diagnostic', label: 'Diagnostic freins' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition ${
                        activeTab === tab.id
                          ? 'bg-white shadow text-violet-700'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeTab === 'analyse' && analysis && (
                  <AnalysisPanel analysis={analysis} />
                )}

                {activeTab === 'questionnaire' && diagnostic && (
                  <QuestionnairePanel
                    diagnostic={diagnostic}
                    onChange={updateDiagnostic}
                    onSave={saveDiagnostic}
                    saving={saving}
                    employee={selectedEmp}
                  />
                )}

                {activeTab === 'diagnostic' && diagnostic && (
                  <FreinsPanel
                    diagnostic={diagnostic}
                    onChange={updateDiagnostic}
                    onSave={saveDiagnostic}
                    saving={saving}
                    analysis={analysis}
                    diagTab={diagTab}
                    setDiagTab={setDiagTab}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════════════════════════
// PANEL : Analyse IA (6 sections)
// ══════════════════════════════════════════════════════════════

function AnalysisPanel({ analysis }) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-solidata-dark">
              {analysis.employee.first_name} {analysis.employee.last_name}
            </h2>
            <p className="text-sm text-gray-500">
              {analysis.employee.team_name || 'Sans equipe'}  - {analysis.employee.position || 'Poste non defini'}
              {analysis.nb_contracts > 0 && `  - ${analysis.nb_contracts} contrat${analysis.nb_contracts > 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="flex gap-2">
            <DataBadge label="PCM" available={analysis.has_pcm} />
            <DataBadge label="CV" available={analysis.has_cv} />
            <DataBadge label="Entretien" available={analysis.has_interview} />
            <DataBadge label="Diagnostic" available={analysis.has_diagnostic} />
          </div>
        </div>
        {/* Sources de donnees */}
        {analysis.data_sources && (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(analysis.data_sources).map(([key, src]) => (
              <div key={key} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border ${
                src.available
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-gray-50 border-gray-200 text-gray-400'
              }`}>
                <span>{src.available ? 'V' : 'X'}</span>
                <span className="font-medium">{src.label}</span>
                {src.available && src.detail && (
                  <span className="text-[10px] opacity-70">({src.detail})</span>
                )}
              </div>
            ))}
          </div>
        )}
        {analysis.confiance < 0.5 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            Confiance : {Math.round(analysis.confiance * 100)}%. Completez le questionnaire CIP et le diagnostic des freins pour ameliorer la precision.
          </div>
        )}
      </div>

      {/* 1. Fiche synthese */}
      {analysis.fiche_synthese && (
        <Section title="1. Fiche synthese profil" color="violet">
          <p className="text-sm text-gray-600 mb-3">{analysis.fiche_synthese.resume}</p>
          {analysis.fiche_synthese.forces.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase">Forces : </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {analysis.fiche_synthese.forces.map(f => (
                  <span key={f} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">{f}</span>
                ))}
              </div>
            </div>
          )}
          {analysis.fiche_synthese.vigilance.length > 0 && (
            <div className="mb-2">
              <span className="text-xs font-bold text-gray-500 uppercase">Vigilance : </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {analysis.fiche_synthese.vigilance.map(v => (
                  <span key={v} className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">{v}</span>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-2">Communication : {analysis.fiche_synthese.communication}</p>
          {analysis.fiche_synthese.motivation.length > 0 && (
            <p className="text-xs text-gray-500">Motivation : {analysis.fiche_synthese.motivation.join(', ')}</p>
          )}
          {analysis.fiche_synthese.sources?.length > 0 && (
            <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100">
              Sources : {analysis.fiche_synthese.sources.join(' + ')}
            </p>
          )}
        </Section>
      )}

      {/* 2. Profil PCM */}
      {analysis.profil_pcm && (
        <Section title="2. Profil PCM simplifie (hypothese)" color="violet">
          <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded mb-3">
            Ceci n'est pas un diagnostic psychologique mais une hypothese de fonctionnement preferentiel, a verifier avec la personne.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(analysis.profil_pcm).map(([type, data]) => (
              <div key={type} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  data.niveau === 'FORT' ? 'bg-violet-100 text-violet-700' :
                  data.niveau === 'MODERE' ? 'bg-blue-100 text-blue-600' :
                  'bg-gray-100 text-gray-400'
                }`}>{data.niveau}</span>
                <div>
                  <p className="text-sm font-medium text-gray-700">{data.label}</p>
                  <p className="text-[10px] text-gray-400">{data.description}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 3. Cartographie des competences */}
      {analysis.competences && (
        <Section title="3. Cartographie des competences" color="blue">
          <CompetenceList title="Competences techniques" items={analysis.competences.techniques} color="blue" />
          <CompetenceList title="Competences transversales" items={analysis.competences.transversales} color="teal" />
          <CompetenceList title="Savoir-etre professionnels" items={analysis.competences.savoir_etre} color="green" />
          <CompetenceList title="A consolider / developper" items={analysis.competences.a_consolider} color="amber" />
        </Section>
      )}

      {/* 4. Pistes de metiers */}
      {analysis.pistes_metiers?.length > 0 && (
        <Section title="4. Pistes de metiers" color="emerald">
          <div className="space-y-3">
            {analysis.pistes_metiers.map((m, i) => (
              <div key={i} className="p-3 bg-gray-50 rounded-lg border">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="font-semibold text-gray-800">{m.metier}</span>
                    <span className="text-xs text-gray-400 ml-2">{m.famille}</span>
                  </div>
                  <ScoreGauge score={m.score} small />
                </div>
                <p className="text-xs text-gray-600 mb-1">{m.pourquoi}</p>
                {m.vigilance.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.vigilance.map((v, j) => (
                      <span key={j} className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded">{v}</span>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-gray-400 mt-1">Evolution : {m.evolution}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Diagnostic freins (resume) */}
      {analysis.freins_sociaux && (
        <Section title="Diagnostic des freins sociaux" color="red">
          <div className="grid grid-cols-7 gap-2 mb-3">
            {analysis.freins_sociaux.freins.map(f => (
              <div key={f.type} className="text-center">
                <div className="text-2xl mb-1">{FREIN_ICONS[f.type]}</div>
                <div className={`text-[10px] font-bold px-1 py-0.5 rounded ${FREIN_COLORS[f.niveau]}`}>
                  {f.niveau}/5
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5">{f.label}</p>
              </div>
            ))}
          </div>
          {analysis.freins_sociaux.nb_freins_majeurs > 0 && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {analysis.freins_sociaux.nb_freins_majeurs} frein(s) majeur(s) detecte(s). Voir le plan d'actions prioritaires ci-dessous.
            </div>
          )}
          {analysis.freins_sociaux.plan_actions.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase">Actions prioritaires</p>
              {analysis.freins_sociaux.plan_actions.map((a, i) => (
                <div key={i} className="flex items-start gap-3 p-2 bg-gray-50 rounded">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${PRIORITY_COLORS[a.priorite]}`}>
                    {a.priorite.toUpperCase()}
                  </span>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-gray-800">{a.action}</p>
                    <p className="text-[10px] text-gray-500">{a.detail}</p>
                  </div>
                  <span className="text-[10px] text-gray-400">{a.echeance}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* 5. Parcours de developpement */}
      {analysis.parcours_dev?.length > 0 && (
        <Section title="5. Parcours de developpement des competences" color="emerald">
          <div className="relative">
            {analysis.parcours_dev.map((phase, idx) => (
              <div key={idx} className="flex gap-4 mb-6 last:mb-0">
                <div className="flex flex-col items-center">
                  <div className={`w-4 h-4 rounded-full ${PHASE_COLORS[phase.statut]} flex-shrink-0 mt-1`} />
                  {idx < analysis.parcours_dev.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gray-200 mt-1" />
                  )}
                </div>
                <div className="flex-1 pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-gray-800">{phase.phase}</h4>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      phase.statut === 'en_cours' ? 'bg-blue-100 text-blue-600' :
                      phase.statut === 'a_planifier' ? 'bg-gray-100 text-gray-500' :
                      'bg-green-100 text-green-600'
                    }`}>
                      {phase.statut === 'en_cours' ? 'En cours' : phase.statut === 'a_planifier' ? 'A planifier' : 'Objectif'}
                    </span>
                    {phase.duree && <span className="text-[10px] text-gray-400">{phase.duree}</span>}
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
                  {phase.indicateurs && (
                    <div className="mt-2 p-2 bg-gray-50 rounded">
                      <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Indicateurs de progression</p>
                      {phase.indicateurs.map((ind, k) => (
                        <p key={k} className="text-[10px] text-gray-500">V {ind}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 6. Recommandations CIP */}
      {analysis.recommandations_cip && (
        <Section title="6. Recommandations pour le CIP" color="amber">
          {analysis.recommandations_cip.points_vigilance?.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">Points de vigilance relationnels</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {analysis.recommandations_cip.points_vigilance.map((rec, i) => (
                  <div key={i} className="p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                    <p className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-1">{rec.titre}</p>
                    <p className="text-sm text-gray-600">{rec.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {analysis.recommandations_cip.conditions_reussite?.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">Conditions de reussite</p>
              <ul className="space-y-1">
                {analysis.recommandations_cip.conditions_reussite.map((c, i) => (
                  <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                    <span className="text-emerald-400 mt-0.5">V</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {analysis.recommandations_cip.outils?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase mb-2">Outils a mobiliser</p>
              <div className="flex flex-wrap gap-1">
                {analysis.recommandations_cip.outils.map((o, i) => (
                  <span key={i} className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded text-xs">{o}</span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PANEL : Questionnaire CIP (entretien)
// ══════════════════════════════════════════════════════════════

function QuestionnairePanel({ diagnostic, onChange, onSave, saving, employee }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border p-5">
        <h2 className="text-lg font-bold text-solidata-dark mb-1">
          Questionnaire d'entretien  - {employee.first_name} {employee.last_name}
        </h2>
        <p className="text-xs text-gray-400">
          Ce questionnaire est administre en entretien par le CIP. Privilegier les questions ouvertes a l'oral, noter les reponses cles.
        </p>
      </div>

      {/* Identite & contexte */}
      <Section title="Identite & Contexte social" color="violet">
        <TextArea label="Parcours anterieur (emplois, formations, periodes d'inactivite)"
          value={diagnostic.parcours_anterieur} onChange={v => onChange('parcours_anterieur', v)}
          placeholder="Ex : A travaille dans la restauration pendant 3 ans, puis sans emploi 1 an..."
        />
        <TextArea label="Contraintes de sante" value={diagnostic.contraintes_sante}
          onChange={v => onChange('contraintes_sante', v)} placeholder="Ex : Mal de dos, port de charges limite..." />
        <TextArea label="Contraintes de mobilite" value={diagnostic.contraintes_mobilite}
          onChange={v => onChange('contraintes_mobilite', v)} placeholder="Ex : Pas de permis, depend du bus..." />
        <TextArea label="Contraintes familiales" value={diagnostic.contraintes_familiales}
          onChange={v => onChange('contraintes_familiales', v)} placeholder="Ex : Parent isole, enfants en bas age..." />
        <TextArea label="Autres contraintes" value={diagnostic.autres_contraintes}
          onChange={v => onChange('autres_contraintes', v)} placeholder="Autres informations pertinentes..." />
      </Section>

      {/* PCM Simplifie */}
      <Section title="Questionnaire PCM simplifie" color="violet">
        <p className="text-xs text-gray-400 mb-3">
          Questions ouvertes a poser a l'oral. Notez les reponses cles, meme en quelques mots.
        </p>
        {PCM_QUESTIONS.map(q => (
          <TextArea
            key={q.key}
            label={q.question}
            value={diagnostic[q.key]}
            onChange={v => onChange(q.key, v)}
            placeholder="Reponse du collaborateur..."
            small
          />
        ))}
      </Section>

      {/* Observations */}
      <Section title="Observations CIP en situation de travail" color="blue">
        <p className="text-xs text-gray-400 mb-3">
          A completer avec le manager. Base sur l'observation directe en poste.
        </p>
        <TextArea label="Taches realisees / postes occupes" value={diagnostic.obs_taches_realisees}
          onChange={v => onChange('obs_taches_realisees', v)} placeholder="Ex : Tri textile, preparation de lots..." />
        <TextArea label="Points forts observes" value={diagnostic.obs_points_forts}
          onChange={v => onChange('obs_points_forts', v)} placeholder="Ex : Ponctuel, soigneux, bon contact..." />
        <TextArea label="Difficultes observees" value={diagnostic.obs_difficultes}
          onChange={v => onChange('obs_difficultes', v)} placeholder="Ex : Difficulte a maintenir le rythme..." />
        <TextArea label="Comportement en equipe" value={diagnostic.obs_comportement_equipe}
          onChange={v => onChange('obs_comportement_equipe', v)} placeholder="Ex : S'integre bien, un peu reserve..." />
        <TextArea label="Autonomie, ponctualite, assiduite" value={diagnostic.obs_autonomie_ponctualite}
          onChange={v => onChange('obs_autonomie_ponctualite', v)} placeholder="Ex : Toujours a l'heure, a besoin de rappels..." />
      </Section>

      {/* Preferences */}
      <Section title="Preferences & Motivations" color="emerald">
        <TextArea label="Ce que la personne dit aimer faire" value={diagnostic.pref_aime_faire}
          onChange={v => onChange('pref_aime_faire', v)} placeholder="Ex : Travailler avec les mains, etre dehors..." />
        <TextArea label="Ce qu'elle ne veut plus faire" value={diagnostic.pref_ne_veut_plus}
          onChange={v => onChange('pref_ne_veut_plus', v)} placeholder="Ex : Rester assise toute la journee..." />
        <TextArea label="Environnements de travail preferes" value={diagnostic.pref_environnement_prefere}
          onChange={v => onChange('pref_environnement_prefere', v)} placeholder="Ex : Collectif, en mouvement..." />
        <TextArea label="Environnements a eviter" value={diagnostic.pref_environnement_eviter}
          onChange={v => onChange('pref_environnement_eviter', v)} placeholder="Ex : Bureau, contact telephonique..." />
        <TextArea label="Objectifs exprimes (meme flous)" value={diagnostic.pref_objectifs}
          onChange={v => onChange('pref_objectifs', v)} placeholder="Ex : Trouver un CDI, passer le permis..." />
      </Section>

      {/* Explorama */}
      <Section title="Explorama - Exploration des interets professionnels" color="teal">
        <p className="text-xs text-gray-400 mb-3">
          Outil base sur des photos et des mises en situation. Notez les reactions spontanees.
        </p>
        <TextArea label="Univers ou photos qui ont suscite de l'interet" value={diagnostic.explorama_interets}
          onChange={v => onChange('explorama_interets', v)} placeholder="Ex : Photos d'atelier couture, entrepot logistique, cuisine..." />
        <TextArea label="Univers ou photos rejetes" value={diagnostic.explorama_rejets}
          onChange={v => onChange('explorama_rejets', v)} placeholder="Ex : Bureau, ordinateur, telephone, travail isole..." />
        <TextArea label="Gestes professionnels apprecies (ce que la personne aime faire avec ses mains/son corps)" value={diagnostic.explorama_gestes_positifs}
          onChange={v => onChange('explorama_gestes_positifs', v)} placeholder="Ex : Trier, plier, porter, conduire, nettoyer, coudre, ranger..." />
        <TextArea label="Gestes professionnels rejetes (ce que la personne n'aime pas faire)" value={diagnostic.explorama_gestes_negatifs}
          onChange={v => onChange('explorama_gestes_negatifs', v)} placeholder="Ex : Ecrire, taper a l'ordinateur, rester assis, parler au telephone..." />
        <TextArea label="Environnements de travail preferes" value={diagnostic.explorama_environnements}
          onChange={v => onChange('explorama_environnements', v)} placeholder="Ex : Exterieur, atelier, entrepot, en equipe, calme, en mouvement..." />
        <TextArea label="Rythme de travail prefere" value={diagnostic.explorama_rythme}
          onChange={v => onChange('explorama_rythme', v)} placeholder="Ex : Regulier, varie, rapide, tranquille, avec pauses frequentes..." small />
      </Section>

      {/* Orientation CIP */}
      <Section title="Orientation souhaitee par le CIP" color="indigo">
        <TextArea label="Hypotheses de metiers du CIP" value={diagnostic.cip_hypotheses_metiers}
          onChange={v => onChange('cip_hypotheses_metiers', v)} placeholder="Ex : Operateur logistique, agent d'entretien..." />
        <TextArea label="Questions ou hesitations du CIP" value={diagnostic.cip_questions}
          onChange={v => onChange('cip_questions', v)} placeholder="Ex : Hesite entre logistique et vente..." />
      </Section>

      <div className="flex justify-end">
        <button onClick={onSave} disabled={saving}
          className="px-6 py-3 bg-violet-600 text-white rounded-xl font-medium hover:bg-violet-700 transition disabled:opacity-50">
          {saving ? 'Sauvegarde...' : 'Sauvegarder et analyser'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PANEL : Diagnostic des freins sociaux
// ══════════════════════════════════════════════════════════════

function FreinsPanel({ diagnostic, onChange, onSave, saving, analysis, diagTab, setDiagTab }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border p-5">
        <h2 className="text-lg font-bold text-solidata-dark mb-1">Diagnostic des freins sociaux</h2>
        <p className="text-xs text-gray-400">
          Evaluez chaque frein de 1 (pas de difficulte) a 5 (bloquant).
          Les questions sont simples et non intrusives, adaptees aux competences linguistiques faibles.
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
        <button
          onClick={() => setDiagTab('freins')}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition ${
            diagTab === 'freins' ? 'bg-white shadow text-red-600' : 'text-gray-500'
          }`}
        >Evaluation des freins</button>
        <button
          onClick={() => setDiagTab('resultats')}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition ${
            diagTab === 'resultats' ? 'bg-white shadow text-red-600' : 'text-gray-500'
          }`}
        >Resultats & priorites</button>
      </div>

      {diagTab === 'freins' && (
        <div className="space-y-3">
          {FREINS_CONFIG.map(frein => (
            <div key={frein.key} className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{FREIN_ICONS[frein.key]}</span>
                <div>
                  <p className="font-semibold text-gray-800">{frein.label}</p>
                  <p className="text-xs text-gray-400">{frein.question}</p>
                </div>
              </div>

              {/* Boutons de niveau (adapté aux faibles compétences linguistiques) */}
              <div className="flex gap-1 mb-2">
                {FREIN_LEVELS.map(level => (
                  <button
                    key={level.value}
                    onClick={() => onChange(`frein_${frein.key}`, level.value)}
                    className={`flex-1 py-2 rounded-lg text-center transition border ${
                      diagnostic[`frein_${frein.key}`] === level.value
                        ? `${FREIN_COLORS[level.value]} border-current font-bold`
                        : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'
                    }`}
                  >
                    <div className="text-lg">{level.emoji}</div>
                    <div className="text-[10px] leading-tight">{level.label}</div>
                  </button>
                ))}
              </div>

              {/* Causes profondes si niveau >= 2 */}
              {diagnostic[`frein_${frein.key}`] >= 2 && frein.causes && (
                <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Causes identifiees :</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {frein.causes.map(cause => {
                      const currentCauses = (diagnostic[`frein_${frein.key}_causes`] || '').split(',').filter(Boolean);
                      const isChecked = currentCauses.includes(cause.id);
                      return (
                        <label key={cause.id} className={`flex items-start gap-2 p-1.5 rounded cursor-pointer text-xs ${isChecked ? 'bg-amber-50 text-amber-800' : 'text-gray-600 hover:bg-gray-100'}`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const updated = isChecked
                                ? currentCauses.filter(c => c !== cause.id)
                                : [...currentCauses, cause.id];
                              onChange(`frein_${frein.key}_causes`, updated.join(','));
                            }}
                            className="mt-0.5 rounded border-gray-300"
                          />
                          <span>{cause.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Detail si niveau >= 3 */}
              {diagnostic[`frein_${frein.key}`] >= 3 && (
                <textarea
                  value={diagnostic[`frein_${frein.key}_detail`] || ''}
                  onChange={e => onChange(`frein_${frein.key}_detail`, e.target.value)}
                  placeholder="Precisez la situation (facultatif)..."
                  className="w-full mt-2 p-2 border rounded-lg text-sm resize-none"
                  rows={2}
                />
              )}
            </div>
          ))}

          <div className="flex justify-end">
            <button onClick={onSave} disabled={saving}
              className="px-6 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition disabled:opacity-50">
              {saving ? 'Sauvegarde...' : 'Sauvegarder le diagnostic'}
            </button>
          </div>
        </div>
      )}

      {diagTab === 'resultats' && analysis?.freins_sociaux && (
        <div className="space-y-4">
          {/* Vue radar simplifiee */}
          <Section title="Synthese des freins" color="red">
            <div className="space-y-2">
              {analysis.freins_sociaux.freins.map(f => (
                <div key={f.type} className="flex items-center gap-3">
                  <span className="text-lg w-8 text-center">{FREIN_ICONS[f.type]}</span>
                  <span className="text-sm font-medium text-gray-700 w-24">{f.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3">
                    <div
                      className={`h-3 rounded-full transition-all ${
                        f.niveau >= 4 ? 'bg-red-500' : f.niveau >= 3 ? 'bg-yellow-400' : 'bg-green-400'
                      }`}
                      style={{ width: `${(f.niveau / 5) * 100}%` }}
                    />
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${FREIN_COLORS[f.niveau]}`}>
                    {f.niveau}/5
                  </span>
                </div>
              ))}
            </div>
          </Section>

          {/* Plan d'actions prioritaires */}
          {analysis.freins_sociaux.plan_actions.length > 0 && (
            <Section title="Plan d'actions prioritaires" color="red">
              <div className="space-y-2">
                {analysis.freins_sociaux.plan_actions.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${PRIORITY_COLORS[a.priorite]}`}>
                      {a.priorite.toUpperCase()}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">{a.action}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{a.detail}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{a.echeance}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Detail par frein avec actions de levee */}
          {analysis.freins_sociaux.freins.filter(f => f.niveau >= 3).map(f => (
            <Section key={f.type} title={`Frein ${f.label}  - Niveau ${f.niveau}/5`} color="red">
              <p className="text-sm text-gray-600 mb-2">{f.niveau_label}</p>
              {f.detail && <p className="text-xs text-gray-500 italic mb-2">"{f.detail}"</p>}
              {f.actions.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase mb-1">Actions a mettre en place</p>
                  <ul className="space-y-1">
                    {f.actions.map((a, i) => (
                      <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                        <span className="text-red-400 mt-0.5">></span>
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          ))}

          {analysis.freins_sociaux.freins.every(f => f.niveau < 3) && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
              <p className="text-lg font-semibold text-green-700">Aucun frein majeur detecte</p>
              <p className="text-sm text-green-600 mt-1">La situation sociale est favorable au parcours d'insertion.</p>
            </div>
          )}
        </div>
      )}

      {diagTab === 'resultats' && !analysis?.freins_sociaux && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
          <p className="text-sm text-amber-700">Completez et sauvegardez le diagnostic des freins pour voir les resultats.</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// COMPOSANTS UTILITAIRES
// ══════════════════════════════════════════════════════════════

function DataBadge({ label, available }) {
  return (
    <span className={`px-2 py-1 rounded-full text-[10px] font-medium ${
      available ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
    }`}>
      {available ? 'V' : 'X'} {label}
    </span>
  );
}

function ScoreGauge({ score, small }) {
  const color = score >= 75 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  const size = small ? 40 : 80;
  const radius = small ? 16 : 32;
  const strokeWidth = small ? 3 : 6;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference - (score / 100) * circumference;

  return (
    <div className={`relative flex-shrink-0`} style={{ width: size, height: size }}>
      <svg className="-rotate-90" style={{ width: size, height: size }} viewBox={`0 0 ${size * 0.9} ${size * 0.9}`}>
        <circle cx={size * 0.45} cy={size * 0.45} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
        <circle cx={size * 0.45} cy={size * 0.45} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={dashoffset}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-bold ${small ? 'text-[10px]' : 'text-lg'}`} style={{ color }}>{score}%</span>
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

function CompetenceList({ title, items, color }) {
  if (!items || items.length === 0) return null;
  const colorMap = { blue: 'bg-blue-50 text-blue-700', teal: 'bg-teal-50 text-teal-700', green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-700' };
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{title}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((item, i) => (
          <span key={i} className={`px-2 py-0.5 rounded text-xs ${colorMap[color] || 'bg-gray-50 text-gray-600'}`}>
            {item.competence}
            {item.source && <span className="text-[8px] ml-1 opacity-60">({item.source})</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, small }) {
  return (
    <div className="mb-3">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full p-2 border rounded-lg text-sm resize-none focus:ring-1 focus:ring-violet-300 focus:border-violet-300"
        rows={small ? 2 : 3}
      />
    </div>
  );
}
