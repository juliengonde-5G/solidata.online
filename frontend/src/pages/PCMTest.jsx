import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const BRAND_GREEN = '#2D8C4E';
const BRAND_GREEN_LIGHT = '#8BC540';

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
      const formattedAnswers = Object.entries(answers).map(([questionId, value]) => ({
        question_id: parseInt(questionId),
        answer: value,
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

  // --- RENDER HELPERS ---

  const renderHeader = () => (
    <div className="text-center py-4 px-4" style={{ backgroundColor: BRAND_GREEN }}>
      <h1 className="text-white text-xl sm:text-2xl font-bold tracking-wide">SOLIDATA</h1>
      <p className="text-white/80 text-xs sm:text-sm mt-0.5">Test de personnalité PCM</p>
    </div>
  );

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 mx-auto" style={{ borderTopColor: BRAND_GREEN }} />
            <p className="mt-4 text-gray-500 text-sm">Chargement du test...</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.27 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Lien invalide</h2>
            <p className="text-gray-500 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'already_done') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Test deja complete</h2>
            <p className="text-gray-500 text-sm">Vous avez deja soumis vos reponses pour ce test. Merci pour votre participation !</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'welcome') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 max-w-lg w-full">
            <div className="text-center mb-6">
              <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold" style={{ backgroundColor: BRAND_GREEN }}>
                {session?.candidate_name?.[0]?.toUpperCase() || '?'}
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
                Bonjour {session?.candidate_name} !
              </h2>
              <p className="text-gray-500 mt-1 text-sm">Bienvenue sur le test de personnalite PCM</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 sm:p-5 mb-6 space-y-3 text-sm text-gray-600">
              <h3 className="font-semibold text-gray-800 text-base">Instructions</h3>
              <ul className="space-y-2">
                <li className="flex gap-2">
                  <span className="font-bold mt-0.5" style={{ color: BRAND_GREEN }}>1.</span>
                  <span>Le test comporte <strong>{totalQuestions} questions</strong>. Pour chaque question, choisissez la reponse qui vous correspond le mieux.</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold mt-0.5" style={{ color: BRAND_GREEN }}>2.</span>
                  <span>Il n'y a pas de bonnes ou mauvaises reponses. Repondez spontanement, sans trop reflechir.</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold mt-0.5" style={{ color: BRAND_GREEN }}>3.</span>
                  <span>Le test prend environ <strong>5 a 10 minutes</strong>.</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold mt-0.5" style={{ color: BRAND_GREEN }}>4.</span>
                  <span>Vos reponses sont <strong>confidentielles</strong> et utilisees uniquement dans le cadre du recrutement.</span>
                </li>
              </ul>
            </div>

            <button
              onClick={() => setPhase('test')}
              className="w-full py-3 rounded-xl text-white font-semibold text-base transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: BRAND_GREEN }}
            >
              Commencer le test
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 mx-auto" style={{ borderTopColor: BRAND_GREEN }} />
            <p className="mt-4 text-gray-600 font-medium">Envoi de vos reponses...</p>
            <p className="mt-1 text-gray-400 text-sm">Veuillez patienter</p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    const baseType = result?.profile?.base_type || result?.base_type;
    const label = TYPE_LABELS[baseType] || baseType || 'Votre profil';
    const description = TYPE_DESCRIPTIONS[baseType] || '';

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 max-w-lg w-full text-center">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
              <svg className="w-10 h-10" style={{ color: BRAND_GREEN }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">Merci {session?.candidate_name} !</h2>
            <p className="text-gray-500 text-sm mb-6">Vos reponses ont ete enregistrees avec succes.</p>

            <div className="rounded-xl p-5 mb-6" style={{ backgroundColor: BRAND_GREEN + '10' }}>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Votre type de base</p>
              <p className="text-2xl font-bold" style={{ color: BRAND_GREEN }}>{label}</p>
              {description && (
                <p className="text-sm text-gray-600 mt-3 leading-relaxed">{description}</p>
              )}
            </div>

            <p className="text-xs text-gray-400">
              L'equipe Solidata reviendra vers vous prochainement. Vous pouvez fermer cette page.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- PHASE: TEST ---
  const q = questions[currentQ];
  if (!q) return null;

  const options = q.options || [];
  const currentAnswer = answers[q.id];
  const isLastQuestion = currentQ === totalQuestions - 1;
  const allAnswered = answeredCount === totalQuestions;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {renderHeader()}

      {/* Progress bar */}
      <div className="bg-white border-b px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-500">
              Question {currentQ + 1} / {totalQuestions}
            </span>
            <span className="text-xs font-semibold" style={{ color: BRAND_GREEN }}>
              {progress}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%`, backgroundColor: BRAND_GREEN }}
            />
          </div>
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col p-4 sm:p-6">
        <div className="max-w-2xl mx-auto w-full flex-1 flex flex-col">
          <div className="bg-white rounded-2xl shadow-sm border p-5 sm:p-6 flex-1">
            <div className="mb-5">
              <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold text-white mb-3" style={{ backgroundColor: BRAND_GREEN }}>
                Q{currentQ + 1}
              </span>
              <h2 className="text-base sm:text-lg font-semibold text-gray-800 leading-relaxed">
                {q.text}
              </h2>
            </div>

            <div className="space-y-2.5">
              {options.map((opt, idx) => {
                const isSelected = currentAnswer === opt.value;
                return (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(q.id, opt.value)}
                    className={`w-full text-left p-3.5 sm:p-4 rounded-xl border-2 transition-all text-sm sm:text-base ${
                      isSelected
                        ? 'border-green-400 bg-green-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                    }`}
                    style={isSelected ? { borderColor: BRAND_GREEN, backgroundColor: BRAND_GREEN + '08' } : {}}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-all ${
                          isSelected ? 'border-green-500' : 'border-gray-300'
                        }`}
                        style={isSelected ? { borderColor: BRAND_GREEN } : {}}
                      >
                        {isSelected && (
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BRAND_GREEN }} />
                        )}
                      </div>
                      <span className={isSelected ? 'font-medium text-gray-800' : 'text-gray-600'}>
                        {opt.label || opt.text}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-4 gap-3">
            <button
              onClick={goPrev}
              disabled={currentQ === 0}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                currentQ === 0
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 active:scale-[0.98]'
              }`}
            >
              Precedent
            </button>

            <div className="flex gap-1.5 overflow-hidden">
              {questions.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentQ(idx)}
                  className="w-2 h-2 rounded-full transition-all flex-shrink-0"
                  style={{
                    backgroundColor: idx === currentQ
                      ? BRAND_GREEN
                      : answers[questions[idx]?.id] !== undefined
                        ? BRAND_GREEN_LIGHT
                        : '#D1D5DB',
                  }}
                />
              ))}
            </div>

            {isLastQuestion && allAnswered ? (
              <button
                onClick={handleSubmit}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ backgroundColor: BRAND_GREEN }}
              >
                Envoyer
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={isLastQuestion}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isLastQuestion
                    ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                    : 'text-white hover:opacity-90 active:scale-[0.98]'
                }`}
                style={!isLastQuestion ? { backgroundColor: BRAND_GREEN } : {}}
              >
                Suivant
              </button>
            )}
          </div>

          {/* Unanswered warning on last question */}
          {isLastQuestion && !allAnswered && (
            <p className="text-center text-xs text-amber-600 mt-3">
              Vous avez repondu a {answeredCount} question{answeredCount > 1 ? 's' : ''} sur {totalQuestions}.
              Veuillez repondre a toutes les questions avant d'envoyer.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
