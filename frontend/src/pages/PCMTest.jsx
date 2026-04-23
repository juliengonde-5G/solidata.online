import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Brain,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Volume2,
  Sparkles,
  Send,
  ExternalLink,
  Check,
} from 'lucide-react';

const TYPE_LABELS = {
  analyseur: 'Analyseur',
  perseverant: 'Persévérant',
  empathique: 'Empathique',
  imagineur: 'Imagineur',
  energiseur: 'Énergiseur',
  promoteur: 'Promoteur',
};

const TYPE_DESCRIPTIONS = {
  analyseur: 'Vous percevez le monde à travers la pensée logique. Rigoureux et organisé, vous aimez comprendre les faits et les données.',
  perseverant: 'Vous percevez le monde à travers vos opinions et valeurs. Engagé et observateur, vous êtes guidé par vos convictions.',
  empathique: 'Vous percevez le monde à travers vos émotions. Chaleureux et sensible, vous accordez une grande importance aux relations.',
  imagineur: 'Vous percevez le monde à travers la réflexion intérieure. Calme et imaginatif, vous avez besoin de temps et d\'espace pour vous.',
  energiseur: 'Vous percevez le monde à travers les réactions. Spontané et créatif, vous aimez le contact et l\'amusement.',
  promoteur: 'Vous percevez le monde à travers l\'action. Direct et adaptable, vous aimez les défis et les résultats concrets.',
};

export default function PCMTest() {
  const { token } = useParams();
  const navigate = useNavigate();

  // Détecte si l'utilisateur vient de l'application (a un token JWT)
  const isFromApp = useMemo(() => !!localStorage.getItem('token'), []);

  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [currentQ, setCurrentQ] = useState(0);
  const [phase, setPhase] = useState('loading'); // loading, welcome, test, submitting, done, error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    axios.get(`/api/pcm/sessions/${token}`)
      .then(res => {
        const data = res.data;
        if (data.session?.status === 'completed') {
          setPhase('already_done');
          return;
        }
        setSession(data.session);
        setQuestions(data.questions || []);
        setPhase('welcome');
      })
      .catch(err => {
        const msg = err.response?.data?.error || 'Lien invalide ou expiré.';
        setError(msg);
        setPhase('error');
      });
  }, [token]);

  const totalQuestions = questions.length;
  const answeredCount = Object.keys(answers).length;
  const progress = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  const handleAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
    // Auto-advance après un délai visuel suffisant pour voir la sélection.
    // 600 ms : compromis accessibilité (temps de lecture pour personnes peu à l'aise
    // avec l'écrit) vs fluidité du test.
    setTimeout(() => {
      setCurrentQ(prev => prev < totalQuestions - 1 ? prev + 1 : prev);
    }, 600);
  };

  const goNext = () => {
    if (currentQ < totalQuestions - 1) setCurrentQ(currentQ + 1);
  };

  const goPrev = () => {
    if (currentQ > 0) setCurrentQ(currentQ - 1);
  };

  const handleSubmit = async () => {
    if (answeredCount < totalQuestions) return;
    setPhase('submitting');
    try {
      const formattedAnswers = Object.entries(answers).map(([num, value]) => ({
        question_number: parseInt(num, 10),
        answer_value: value,
      }));
      const res = await axios.post('/api/pcm/submit', {
        access_token: token,
        answers: formattedAnswers,
      });
      setResult(res.data);
      setPhase('done');
    } catch (err) {
      const msg = err.response?.data?.error || 'Erreur lors de la soumission.';
      setError(msg);
      setPhase('error');
    }
  };

  // Lecture audio de la question (Web Speech API)
  const speakQuestion = (text) => {
    if (!text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new window.SpeechSynthesisUtterance(text);
      utter.lang = 'fr-FR';
      utter.rate = 0.95;
      window.speechSynthesis.speak(utter);
    } catch { /* no-op */ }
  };

  // --- RENDER HELPERS ---

  const renderHeader = () => (
    <header className="relative bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 px-4 py-5 text-center shadow-card">
      <div className="max-w-3xl mx-auto flex items-center justify-center gap-3">
        <span className="brand-mark inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/20 backdrop-blur text-white">
          <Brain className="w-5 h-5" strokeWidth={2.2} />
        </span>
        <div className="text-left">
          <h1 className="text-white text-xl sm:text-2xl font-extrabold tracking-tight leading-none">SOLIDATA</h1>
          <p className="text-white/80 text-xs sm:text-sm mt-0.5">Test de personnalité PCM</p>
        </div>
      </div>
    </header>
  );

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-200 border-t-teal-600 mx-auto" />
            <p className="mt-4 text-slate-500 text-sm">Chargement du test...</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="section-card p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" strokeWidth={2} />
            </div>
            <h2 className="text-lg font-extrabold text-slate-800 mb-2">Lien invalide</h2>
            <p className="text-slate-500 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'already_done') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="section-card p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-teal-600" strokeWidth={2} />
            </div>
            <h2 className="text-lg font-extrabold text-slate-800 mb-2">Test déjà complété</h2>
            <p className="text-slate-500 text-sm mb-4">Vous avez déjà soumis vos réponses pour ce test. Merci pour votre participation !</p>
            {isFromApp ? (
              <button
                onClick={() => navigate('/pcm')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition-colors shadow-teal-glow"
              >
                <ArrowLeft className="w-4 h-4" />
                Retour à l'application
              </button>
            ) : (
              <a
                href="https://solidarite-textile.fr"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition-colors shadow-teal-glow"
              >
                Visiter Solidarité Textile
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'welcome') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="section-card p-6 sm:p-8 max-w-lg w-full">
            <div className="text-center mb-6">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 text-white text-2xl font-extrabold bg-gradient-to-br from-teal-500 to-teal-700 shadow-teal-glow">
                {(session?.first_name || session?.candidate_name)?.[0]?.toUpperCase() || '?'}
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-800 tracking-tight">
                Bonjour {session?.first_name || session?.candidate_name || 'candidat'} !
              </h2>
              <p className="text-slate-500 mt-1 text-sm">Quelques questions pour mieux vous connaître</p>
            </div>

            <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 sm:p-5 mb-6 space-y-3 text-sm text-slate-700">
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-teal-600" />
                Comment faire ?
              </h3>
              <ul className="space-y-2.5">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold grid place-items-center mt-0.5">1</span>
                  <span><strong>{totalQuestions} questions</strong>. Choisissez la réponse (ou l'image) qui vous ressemble le plus.</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold grid place-items-center mt-0.5">2</span>
                  <span>Pas de bonne ou mauvaise réponse. Répondez comme vous sentez.</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold grid place-items-center mt-0.5">3</span>
                  <span>Environ <strong>5 à 10 minutes</strong>.</span>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold grid place-items-center mt-0.5">4</span>
                  <span>Vos réponses restent <strong>confidentielles</strong>.</span>
                </li>
              </ul>
            </div>

            <button
              onClick={() => setPhase('test')}
              className="w-full py-3.5 rounded-xl text-white font-bold text-base bg-teal-600 hover:bg-teal-700 shadow-teal-glow transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2"
            >
              Commencer le test
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-slate-200 border-t-teal-600 mx-auto" />
            <p className="mt-4 text-slate-700 font-semibold">Envoi de vos réponses...</p>
            <p className="mt-1 text-slate-400 text-sm">Veuillez patienter</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const baseType = result?.profile?.baseType || result?.profile?.base_type || result?.baseType || result?.base_type;
    const phaseType = result?.profile?.phaseType || result?.profile?.phase_type;
    const baseConfidence = result?.profile?.baseConfidence ?? 0;
    const phaseConfidence = result?.profile?.phaseConfidence ?? 0;
    const baseIndetermine = result?.profile?.baseIndetermine === true;
    const label = TYPE_LABELS[baseType] || baseType || 'Votre profil';
    const description = TYPE_DESCRIPTIONS[baseType] || '';

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="section-card p-6 sm:p-8 max-w-lg w-full text-center">
            <div className="w-20 h-20 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-10 h-10 text-teal-600" strokeWidth={2} />
            </div>

            <h2 className="text-xl sm:text-2xl font-extrabold text-slate-800 mb-2 tracking-tight">
              Merci {session?.first_name || session?.candidate_name} !
            </h2>
            <p className="text-slate-500 text-sm mb-6">Vos réponses ont été enregistrées avec succès.</p>

            <div className="rounded-2xl p-5 mb-6 bg-teal-50 border border-teal-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-bold mb-1">Votre type de base</p>
              <p className="text-2xl font-extrabold text-teal-700">{label}</p>
              {description && (
                <p className="text-sm text-slate-600 mt-3 leading-relaxed">{description}</p>
              )}
              {phaseType && phaseType !== baseType && TYPE_LABELS[phaseType] && (
                <p className="text-xs text-slate-500 mt-3">
                  État actuel (phase) : <span className="font-bold">{TYPE_LABELS[phaseType]}</span>
                </p>
              )}
              {baseIndetermine && (
                <p className="text-xs text-amber-600 mt-3 font-semibold">
                  Résultat peu marqué — des réponses complémentaires seront utiles.
                </p>
              )}
              {!baseIndetermine && baseConfidence > 0 && (
                <p className="text-xs text-slate-400 mt-3">
                  Fiabilité base {baseConfidence}% · phase {phaseConfidence}%
                </p>
              )}
            </div>

            <p className="text-xs text-slate-400 mb-4">
              L'équipe Solidata reviendra vers vous prochainement.
            </p>

            {isFromApp ? (
              <button
                onClick={() => navigate('/pcm')}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition-colors shadow-teal-glow"
              >
                <ArrowLeft className="w-4 h-4" />
                Retour à l'application
              </button>
            ) : (
              <a
                href="https://solidarite-textile.fr"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-button bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition-colors shadow-teal-glow"
              >
                Visiter Solidarité Textile
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- PHASE: TEST ---
  const q = questions[currentQ];
  if (!q) return null;
  const questionKey = q.num ?? q.id ?? currentQ + 1;

  const options = q.options || [];
  const currentAnswer = answers[questionKey];
  const isLastQuestion = currentQ === totalQuestions - 1;
  const allAnswered = answeredCount === totalQuestions;
  const questionText = q.text_simple || q.text;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {renderHeader()}

      {/* Progress bar */}
      <div className="bg-white border-b border-slate-100 px-4 py-3 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-slate-500">
              Question {currentQ + 1} / {totalQuestions}
            </span>
            <span className="text-xs font-bold text-teal-600">
              {progress}%
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-teal-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col p-4 sm:p-6">
        <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col">
          <div className="section-card p-6 sm:p-8 flex-1">
            <div className="mb-6">
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold text-white bg-teal-600">
                  Q{currentQ + 1}
                </span>
                <button
                  type="button"
                  onClick={() => speakQuestion(questionText)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-100 transition-colors"
                  aria-label="Écouter la question"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Écouter la question
                </button>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-800 leading-snug tracking-tight">
                {questionText}
              </h2>
            </div>

            <div className="space-y-3">
              {options.map((opt, idx) => {
                const isSelected = currentAnswer === opt.value;
                const optLabel = opt.label_simple || opt.label;
                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(questionKey, opt.value)}
                    className={`w-full text-left p-4 sm:p-5 rounded-2xl border-2 transition-all flex items-center gap-4 active:scale-[0.99] ${
                      isSelected
                        ? 'border-teal-600 bg-teal-50 shadow-teal-glow'
                        : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40'
                    }`}
                    style={{ minHeight: '60px' }}
                  >
                    {opt.icon && (
                      <span className="text-2xl sm:text-3xl flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-xl bg-white border border-slate-100 shadow-card">
                        {opt.icon}
                      </span>
                    )}
                    <div className="flex-1 flex items-center gap-3">
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                          isSelected ? 'border-teal-600 bg-teal-600' : 'border-slate-300'
                        }`}
                      >
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                        )}
                      </div>
                      <span className={`text-base sm:text-lg ${isSelected ? 'font-bold text-teal-800' : 'text-slate-700 font-medium'}`}>
                        {optLabel}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-slate-400 mt-5 text-center">
              Tu peux changer ta réponse avant de passer à la question suivante.
            </p>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-4 gap-3">
            <button
              onClick={goPrev}
              disabled={currentQ === 0}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-button text-sm font-semibold transition-all ${
                currentQ === 0
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 active:scale-[0.98]'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Précédent
            </button>

            <div className="flex gap-1.5 overflow-hidden flex-1 justify-center max-w-[50%]">
              {questions.map((_, idx) => {
                const qId = questions[idx]?.num ?? questions[idx]?.id;
                const isCurrent = idx === currentQ;
                const isAnswered = answers[qId] !== undefined;
                return (
                  <button
                    key={idx}
                    onClick={() => setCurrentQ(idx)}
                    className={`w-2 h-2 rounded-full transition-all flex-shrink-0 ${
                      isCurrent
                        ? 'bg-teal-600 w-4'
                        : isAnswered
                          ? 'bg-teal-400'
                          : 'bg-slate-300'
                    }`}
                    aria-label={`Question ${idx + 1}`}
                  />
                );
              })}
            </div>

            {isLastQuestion && allAnswered ? (
              <button
                onClick={handleSubmit}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-button text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 shadow-teal-glow transition-all active:scale-[0.98]"
              >
                Envoyer
                <Send className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={isLastQuestion}
                className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-button text-sm font-semibold transition-all ${
                  isLastQuestion
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    : 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-glow active:scale-[0.98]'
                }`}
              >
                Suivant
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Unanswered warning on last question */}
          {isLastQuestion && !allAnswered && (
            <p className="text-center text-xs text-amber-600 mt-3 font-medium inline-flex items-center gap-1 justify-center">
              <AlertTriangle className="w-3.5 h-3.5" />
              Vous avez répondu à {answeredCount} question{answeredCount > 1 ? 's' : ''} sur {totalQuestions}.
              Veuillez répondre à toutes les questions avant d'envoyer.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
