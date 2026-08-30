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
  ShieldCheck,
  Printer,
} from 'lucide-react';
import {
  PCM_MENTION_METHODE, PCM_LIBELLE_ECART, PCM_BADGE_PEU_MARQUE, PCM_NOTICE_INFORMATION,
} from '../utils/pcm';
import { exportRestitutionCandidatPDF } from '../utils/pcm-pdf';

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
  // 'notice' s'intercale AVANT 'welcome' depuis la 2.45.0 : la personne est
  // informée avant de voir la première question, et rien ne commence sans elle.
  const [phase, setPhase] = useState('loading'); // loading, notice, refus, welcome, test, submitting, done, error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [noticeLue, setNoticeLue] = useState(false);
  const [noticeEnCours, setNoticeEnCours] = useState(false);
  const [noticeErreur, setNoticeErreur] = useState('');
  const [restitutionErreur, setRestitutionErreur] = useState('');
  const [restitutionEnCours, setRestitutionEnCours] = useState(false);

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
        // Notice déjà confirmée (reprise après coupure, retour en arrière) : on
        // ne la redemande pas — elle a été lue, c'est daté, et la réafficher
        // ferait douter d'une étape déjà franchie.
        setPhase(data.session?.notice_acceptee_at ? 'welcome' : 'notice');
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

  /**
   * Confirmation de lecture de la notice. Le serveur horodate ; l'écran ne fait
   * qu'avancer une fois qu'il a répondu — s'il refuse, on ne laisse PAS
   * commencer : la trace est ce qui fait tenir l'information préalable, et une
   * confirmation qui n'aurait pas été enregistrée n'en serait pas une.
   */
  const confirmerNotice = async () => {
    if (!noticeLue || noticeEnCours) return;
    setNoticeEnCours(true);
    setNoticeErreur('');
    try {
      await axios.post(`/api/pcm/sessions/${token}/notice`);
      setPhase('welcome');
    } catch (err) {
      setNoticeErreur(err.response?.data?.error
        || "Nous n'avons pas pu enregistrer votre confirmation. Vérifiez votre connexion et réessayez.");
    } finally {
      setNoticeEnCours(false);
    }
  };

  /**
   * Le candidat repart avec son résultat (art. 15). On repasse par le serveur
   * plutôt que d'imprimer ce que la soumission a renvoyé : c'est la même
   * projection expurgée pour tout le monde, et la demande est journalisée.
   */
  const imprimerMonResultat = async () => {
    setRestitutionErreur('');
    setRestitutionEnCours(true);
    try {
      const r = await axios.get(`/api/pcm/sessions/${token}/restitution`);
      if (exportRestitutionCandidatPDF(r.data) === false) {
        setRestitutionErreur("La fenêtre d'impression a été bloquée par votre navigateur. Autorisez les fenêtres pour ce site, puis réessayez.");
      }
    } catch (err) {
      setRestitutionErreur(err.response?.data?.error
        || "Votre résultat n'a pas pu être préparé. Réessayez, ou demandez-le à la personne qui vous a envoyé ce lien.");
    } finally {
      setRestitutionEnCours(false);
    }
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

            {/* Le résultat reste accessible à la personne après coup (art. 15) :
                un candidat qui a fermé la page à la fin du test n'a pas perdu
                son droit d'en obtenir une copie. Même chemin, même document. */}
            <button
              onClick={imprimerMonResultat}
              disabled={restitutionEnCours}
              className="w-full mb-4 py-3 rounded-xl border-2 border-teal-600 text-teal-700 font-bold text-sm hover:bg-teal-50 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Printer className="w-4 h-4" />
              {restitutionEnCours ? 'Préparation…' : 'Imprimer mon résultat'}
            </button>
            {restitutionErreur && (
              <p className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg p-2 text-left">
                {restitutionErreur}
              </p>
            )}
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

  // ── NOTICE D'INFORMATION PRÉALABLE (2.45.0) ────────────────────────────────
  // Elle vient AVANT tout le reste : la personne doit savoir à quoi elle
  // répond, qui le lira et combien de temps c'est gardé avant de répondre —
  // pas après. Le texte vit dans utils/pcm.js (source unique, FALC).
  if (phase === 'refus') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {renderHeader()}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="section-card p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-slate-500" strokeWidth={2} />
            </div>
            <h2 className="text-lg font-extrabold text-slate-800 mb-3">{PCM_NOTICE_INFORMATION.refus.titre}</h2>
            <p className="text-slate-600 text-sm leading-relaxed">{PCM_NOTICE_INFORMATION.refus.corps}</p>
            {/* Retour possible : refuser n'est pas un aiguillage sans retour —
                quelqu'un qui a cliqué par erreur doit pouvoir revenir. */}
            <button
              onClick={() => setPhase('notice')}
              className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-button border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Revenir aux informations
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'notice') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        {renderHeader()}
        <div className="flex-1 flex items-start justify-center p-4 sm:p-6">
          <div className="section-card p-6 sm:p-8 max-w-lg w-full my-4">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex-shrink-0 w-10 h-10 rounded-xl bg-teal-100 grid place-items-center">
                <ShieldCheck className="w-5 h-5 text-teal-700" strokeWidth={2.2} />
              </span>
              <h2 className="text-lg sm:text-xl font-extrabold text-slate-800 tracking-tight">
                {PCM_NOTICE_INFORMATION.titre}
              </h2>
            </div>
            <p className="text-sm text-slate-600 mb-5">{PCM_NOTICE_INFORMATION.chapeau}</p>

            <div className="space-y-3 mb-5">
              {PCM_NOTICE_INFORMATION.blocs.map((bloc) => (
                <div key={bloc.cle} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h3 className="font-bold text-slate-800 text-sm mb-2">{bloc.titre}</h3>
                  <ul className="space-y-1.5">
                    {bloc.points.map((pt, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-700 leading-relaxed">
                        <span className="text-teal-600 font-bold flex-shrink-0">•</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Mention de méthode — la MÊME que partout ailleurs (utils/pcm.js).
                Elle a sa place ici, où la personne décide de répondre, et non
                plus sur l'écran suivant : c'est le moment où elle en a besoin. */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 mb-5">
              <p className="text-xs font-bold text-slate-700 mb-1">Ce que ce questionnaire est — et ce qu'il n'est pas</p>
              <p className="text-xs text-slate-600 leading-relaxed">{PCM_MENTION_METHODE}</p>
            </div>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={noticeLue}
                onChange={(e) => setNoticeLue(e.target.checked)}
                className="mt-0.5 w-5 h-5 accent-teal-600 flex-shrink-0"
              />
              <span className="text-sm font-semibold text-slate-800">{PCM_NOTICE_INFORMATION.confirmation}</span>
            </label>

            {noticeErreur && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm p-3 mb-4">
                {noticeErreur}
              </div>
            )}

            <button
              onClick={confirmerNotice}
              disabled={!noticeLue || noticeEnCours}
              className="w-full py-3.5 rounded-xl text-white font-bold text-base bg-teal-600 hover:bg-teal-700 shadow-teal-glow transition-all active:scale-[0.98] inline-flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {noticeEnCours ? 'Enregistrement…' : 'Continuer'}
              <ArrowRight className="w-4 h-4" />
            </button>
            {/* Sortie possible, et sans reproche : ne pas répondre est un droit. */}
            <button
              onClick={() => setPhase('refus')}
              className="w-full mt-2 py-2.5 rounded-xl text-slate-600 font-semibold text-sm hover:bg-slate-100 transition-colors"
            >
              Je ne souhaite pas répondre
            </button>
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

            {/* L'encart de méthode (audit PCM 2.43.0, R2) a MIGRÉ sur l'écran de
                notice qui précède : il y est lu au moment où la personne décide
                de répondre. L'afficher deux fois de suite l'aurait affaibli. */}

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
              {/* « Fiabilité » renommé (audit PCM 2.43.0, R3) : ce nombre est
                  l'écart entre le type arrivé en tête et le suivant, pas une
                  garantie de justesse — et il était montré tel quel au
                  candidat. Badge ambre quand le profil ne tranche pas. */}
              {baseIndetermine && (
                <p className="mt-3">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                    {PCM_BADGE_PEU_MARQUE}
                  </span>
                  <span className="block text-xs text-slate-500 mt-1">
                    Plusieurs types vous correspondent presque autant — nous en reparlerons ensemble.
                  </span>
                </p>
              )}
              {!baseIndetermine && baseConfidence > 0 && (
                <p className="text-xs text-slate-400 mt-3">
                  {PCM_LIBELLE_ECART} — base {baseConfidence}% · phase {phaseConfidence}%
                </p>
              )}
            </div>

            {/* Restitution (2.45.0, art. 15 RGPD) — la personne repart avec son
                résultat. Jusqu'ici elle voyait son type de base à l'écran et
                repartait sans rien. Le document exclut l'indicateur de cohérence
                des réponses et tout vocabulaire clinique (voir pcm-pdf.js). */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 mb-4 text-left">
              <p className="text-sm font-bold text-slate-800 mb-1">Gardez votre résultat</p>
              <p className="text-xs text-slate-600 mb-3">
                Vous pouvez imprimer votre résultat ou l'enregistrer en PDF. Il est à vous.
              </p>
              <button
                onClick={imprimerMonResultat}
                disabled={restitutionEnCours}
                className="w-full py-3 rounded-xl border-2 border-teal-600 text-teal-700 font-bold text-sm hover:bg-teal-50 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Printer className="w-4 h-4" />
                {restitutionEnCours ? 'Préparation…' : 'Imprimer mon résultat'}
              </button>
              {restitutionErreur && (
                <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg p-2">
                  {restitutionErreur}
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
