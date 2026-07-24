import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { MessageSquare, CheckCircle2, AlertTriangle, ShieldCheck, Send, RotateCcw, Lock } from 'lucide-react';
import QuestionField from '../components/enquetes/QuestionField';
import { newJeton } from '../components/enquetes/enquetesShared';

/**
 * Page PUBLIQUE de réponse à une enquête (route /enquete/:token, HORS
 * ProtectedRoute — comme /pcm-test/:token). Mode kiosque FALC : gros contrôles,
 * texte large, fort contraste, peu de défilement. AUCUN champ d'identité.
 *
 * Endpoints publics (non authentifiés) :
 *   GET  /api/enquetes/public/:token  → { campagne, modele, questions } (404 si close)
 *   POST /api/enquetes/public/:token  → 201 (403 close, 400 obligatoires, 409 doublon)
 */

// Miroir de isAnswered (backend enquetes.js) : tolère 0 et false.
function answered(val, type) {
  if (val === undefined || val === null) return false;
  if (type === 'choix_multiple') return Array.isArray(val) && val.length > 0;
  if (typeof val === 'string') return val.trim() !== '';
  return true;
}

export default function EnqueteReponse() {
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | form | submitting | done | closed | error
  const [data, setData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [invalidIds, setInvalidIds] = useState(new Set());
  const [error, setError] = useState('');
  const [jeton, setJeton] = useState(() => newJeton());
  const topRef = useRef(null);

  const loadSurvey = useCallback(() => {
    setPhase('loading');
    axios.get(`/api/enquetes/public/${token}`)
      .then((res) => { setData(res.data); setPhase('form'); })
      .catch((err) => {
        if (err.response?.status === 404) setPhase('closed');
        else { setError(err.response?.data?.error || 'Impossible de charger l\'enquête.'); setPhase('error'); }
      });
  }, [token]);

  useEffect(() => { loadSurvey(); }, [loadSurvey]);

  const questions = data?.questions || [];
  const modele = data?.modele || {};
  const campagne = data?.campagne || {};

  const setAnswer = (qid, value) => {
    setAnswers((a) => ({ ...a, [qid]: value }));
    setInvalidIds((prev) => {
      if (!prev.has(qid)) return prev;
      const next = new Set(prev); next.delete(qid); return next;
    });
  };

  const submit = async () => {
    // Validation client des obligatoires (le backend revalide de toute façon).
    const missing = questions.filter((q) => q.obligatoire && !answered(answers[q.id], q.type));
    if (missing.length) {
      setInvalidIds(new Set(missing.map((q) => q.id)));
      setError('Merci de répondre aux questions marquées d\'une étoile.');
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setError('');
    setPhase('submitting');
    try {
      await axios.post(`/api/enquetes/public/${token}`, { reponses: answers, jeton_unicite: jeton });
      setPhase('done');
    } catch (err) {
      const status = err.response?.status;
      if (status === 409) { setPhase('duplicate'); return; }
      if (status === 403) { setPhase('closed'); return; }
      if (status === 400) {
        const manquantes = err.response?.data?.manquantes || [];
        setInvalidIds(new Set(manquantes.map((m) => m.question_id)));
        setError('Merci de répondre aux questions marquées d\'une étoile.');
        setPhase('form');
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      setError(err.response?.data?.error || 'L\'envoi a échoué. Vérifiez votre connexion et réessayez.');
      setPhase('form');
    }
  };

  const restart = () => {
    setAnswers({});
    setInvalidIds(new Set());
    setError('');
    setJeton(newJeton());
    setPhase('form');
    window.scrollTo({ top: 0 });
  };

  // ── États pleine page ──────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-14 w-14 border-4 border-slate-200 border-t-teal-600 mx-auto" />
            <p className="mt-4 text-slate-500">Chargement de l'enquête…</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'closed') {
    return (
      <Shell>
        <CenterCard>
          <IconCircle tone="slate"><Lock className="w-9 h-9 text-slate-500" /></IconCircle>
          <h2 className="text-2xl font-extrabold text-slate-800 mb-2">Enquête close ou introuvable</h2>
          <p className="text-slate-500 text-base">Cette enquête n'est pas ouverte aux réponses, ou le lien n'est plus valide.</p>
        </CenterCard>
      </Shell>
    );
  }

  if (phase === 'duplicate') {
    return (
      <Shell>
        <CenterCard>
          <IconCircle tone="teal"><CheckCircle2 className="w-9 h-9 text-teal-600" /></IconCircle>
          <h2 className="text-2xl font-extrabold text-slate-800 mb-2">Réponse déjà enregistrée</h2>
          <p className="text-slate-500 text-base">Une réponse a déjà été envoyée depuis cet appareil pour cette enquête. Merci !</p>
        </CenterCard>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell>
        <CenterCard>
          <IconCircle tone="red"><AlertTriangle className="w-9 h-9 text-red-500" /></IconCircle>
          <h2 className="text-2xl font-extrabold text-slate-800 mb-2">Une erreur est survenue</h2>
          <p className="text-slate-500 text-base mb-5">{error}</p>
          <button onClick={loadSurvey} className="px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-base">Réessayer</button>
        </CenterCard>
      </Shell>
    );
  }

  if (phase === 'submitting') {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-14 w-14 border-4 border-slate-200 border-t-teal-600 mx-auto" />
            <p className="mt-4 text-slate-700 font-semibold text-lg">Envoi de votre réponse…</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === 'done') {
    return (
      <Shell>
        <CenterCard>
          <IconCircle tone="teal"><CheckCircle2 className="w-10 h-10 text-teal-600" /></IconCircle>
          <h2 className="text-2xl font-extrabold text-slate-800 mb-2">Merci pour votre réponse !</h2>
          <p className="text-slate-500 text-base mb-6">Votre participation a bien été enregistrée{modele.anonyme ? ', de façon anonyme' : ''}.</p>
          <button onClick={restart} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-base active:scale-[0.98]">
            <RotateCcw className="w-5 h-5" /> Nouvelle réponse
          </button>
          <p className="text-xs text-slate-400 mt-3">Pour la personne suivante, sur un appareil partagé.</p>
        </CenterCard>
      </Shell>
    );
  }

  // ── Formulaire ──────────────────────────────────────────────────────────────
  return (
    <Shell>
      <div ref={topRef} />
      <div className="flex-1 p-4 sm:p-6">
        <div className="max-w-2xl mx-auto space-y-5">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h2 className="text-2xl font-extrabold text-slate-800 leading-tight">{modele.titre || campagne.titre}</h2>
            {modele.description && <p className="text-slate-600 mt-2 text-base leading-relaxed">{modele.description}</p>}
            {modele.anonyme && (
              <div className="mt-4 inline-flex items-center gap-2 bg-teal-50 text-teal-800 border border-teal-100 rounded-xl px-3 py-2 text-sm font-medium">
                <ShieldCheck className="w-5 h-5 flex-shrink-0" />
                Réponse anonyme — aucune information permettant de vous identifier n'est demandée.
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="bg-red-50 border-2 border-red-200 text-red-700 rounded-xl p-4 text-base font-medium flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}

          {questions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 text-center text-slate-500">
              Cette enquête ne comporte aucune question.
            </div>
          ) : (
            questions.map((q, i) => (
              <div key={q.id} className={`bg-white rounded-2xl shadow-sm border p-6 ${invalidIds.has(q.id) ? 'border-red-300' : 'border-slate-100'}`}>
                <p className="text-lg font-bold text-slate-800 mb-4 leading-snug">
                  <span className="text-slate-400">{i + 1}.</span> {q.libelle}
                  {q.obligatoire && <span className="text-red-500" title="Réponse obligatoire"> *</span>}
                </p>
                <QuestionField
                  question={q}
                  value={answers[q.id]}
                  onChange={(v) => setAnswer(q.id, v)}
                  invalid={invalidIds.has(q.id)}
                  idPrefix="rep"
                />
              </div>
            ))
          )}

          {questions.length > 0 && (
            <div className="pb-8">
              <button
                onClick={submit}
                className="w-full py-4 rounded-2xl text-white font-extrabold text-xl bg-teal-600 hover:bg-teal-700 shadow-lg active:scale-[0.99] inline-flex items-center justify-center gap-2"
              >
                Envoyer ma réponse <Send className="w-5 h-5" />
              </button>
              {modele.anonyme && (
                <p className="text-center text-xs text-slate-400 mt-3">Vos réponses sont anonymes et ne servent qu'à des statistiques d'ensemble.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

// ── Habillage kiosque ─────────────────────────────────────────────────────────
function Shell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 px-4 py-5 shadow">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 backdrop-blur text-white">
            <MessageSquare className="w-6 h-6" strokeWidth={2.2} />
          </span>
          <div>
            <h1 className="text-white text-xl sm:text-2xl font-extrabold tracking-tight leading-none">SOLIDATA</h1>
            <p className="text-white/80 text-xs sm:text-sm mt-0.5">Votre avis compte</p>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function CenterCard({ children }) {
  return (
    <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 max-w-md w-full text-center">{children}</div>
    </div>
  );
}

function IconCircle({ tone, children }) {
  const tones = { teal: 'bg-teal-100', slate: 'bg-slate-100', red: 'bg-red-100' };
  return <div className={`w-20 h-20 rounded-full ${tones[tone] || tones.teal} flex items-center justify-center mx-auto mb-5`}>{children}</div>;
}
