import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const CODE_LENGTH = 6;
const BACKUP_CODE_LENGTH = 11; // format XXXXX-XXXXX

// Ajoute automatiquement le tiret du format XXXXX-XXXXX pendant la saisie.
function formatBackupCode(raw) {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (cleaned.length <= 5) return cleaned;
  return `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`;
}

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, verifyMfa } = useAuth();
  const navigate = useNavigate();

  // Étape 2 — vérification en deux étapes (défi TOTP posé par le backend
  // avant tout jeton complet : POST /auth/login peut répondre
  // { mfa_required: true, mfa_challenge_token } au lieu d'une session).
  const [step, setStep] = useState('password'); // 'password' | 'mfa'
  const [mfaChallengeToken, setMfaChallengeToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [mfaError, setMfaError] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [backupNotice, setBackupNotice] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result && result.mfa_required) {
        setMfaChallengeToken(result.mfa_challenge_token);
        setMfaCode('');
        setUseBackupCode(false);
        setMfaError('');
        setBackupNotice('');
        setStep('mfa');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();
    setMfaError('');
    setMfaLoading(true);
    try {
      const result = await verifyMfa(mfaChallengeToken, mfaCode.trim());
      if (result?.backup_code_used) {
        const restants = result.backup_codes_restants;
        setBackupNotice(
          typeof restants === 'number'
            ? `Code de secours utilisé — il vous en reste ${restants}.`
            : 'Code de secours utilisé.'
        );
        // Laisse le message visible un court instant avant de rejoindre l'application.
        setTimeout(() => navigate('/'), 1800);
      } else {
        navigate('/');
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        setMfaError(err.response?.data?.error || 'Trop de tentatives. Réessayez dans quelques minutes.');
      } else if (status === 401) {
        setMfaError(
          err.response?.data?.error ||
            (useBackupCode
              ? 'Code de secours invalide ou déjà utilisé.'
              : 'Code invalide. Vérifiez l’heure de votre appareil et réessayez.')
        );
      } else {
        setMfaError(err.response?.data?.error || 'Erreur lors de la vérification.');
      }
    } finally {
      setMfaLoading(false);
    }
  };

  const handleBackToPassword = () => {
    setStep('password');
    setPassword('');
    setMfaCode('');
    setMfaChallengeToken('');
    setMfaError('');
    setBackupNotice('');
    setUseBackupCode(false);
  };

  const handleCodeChange = (e) => {
    if (useBackupCode) {
      setMfaCode(formatBackupCode(e.target.value));
    } else {
      setMfaCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH));
    }
  };

  const toggleBackupCode = () => {
    setUseBackupCode((v) => !v);
    setMfaCode('');
    setMfaError('');
  };

  const mfaCodeReady = useBackupCode ? mfaCode.length === BACKUP_CODE_LENGTH : mfaCode.length === CODE_LENGTH;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--color-bg)]">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 pointer-events-none" aria-hidden="true" />
      <div className="relative w-full max-w-md">
        <div className="card-modern p-8 sm:p-10 shadow-elevated">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
              <span className="text-white text-2xl font-bold">S</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">SOLIDATA</h1>
            <p className="text-slate-500 mt-1 text-sm">
              {step === 'password' ? 'Collecte, tri & insertion — Métropole Rouen' : 'Vérification en deux étapes'}
            </p>
          </div>

          {step === 'password' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-button text-sm" role="alert">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Identifiant</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-modern"
                  placeholder="Nom d'utilisateur"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-modern"
                  placeholder="••••••••"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 rounded-button font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Connexion...' : 'Se connecter'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              {mfaError && (
                <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-button text-sm" role="alert">
                  {mfaError}
                </div>
              )}
              {backupNotice && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-button text-sm" role="status">
                  {backupNotice}
                </div>
              )}

              <p className="text-sm text-slate-600 -mt-2">
                {useBackupCode
                  ? 'Saisissez l’un de vos codes de secours (usage unique).'
                  : 'Saisissez le code affiché par votre application d’authentification.'}
              </p>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {useBackupCode ? 'Code de secours' : 'Code de vérification'}
                </label>
                <input
                  type="text"
                  value={mfaCode}
                  onChange={handleCodeChange}
                  className="input-modern text-center tracking-[0.35em] font-mono text-lg"
                  placeholder={useBackupCode ? 'XXXXX-XXXXX' : '000000'}
                  inputMode={useBackupCode ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={useBackupCode ? BACKUP_CODE_LENGTH : CODE_LENGTH}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={mfaLoading || !mfaCodeReady}
                className="btn-primary w-full py-3 rounded-button font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mfaLoading ? 'Vérification...' : 'Vérifier'}
              </button>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={handleBackToPassword}
                  className="text-slate-500 hover:text-slate-700 font-medium"
                >
                  ← Retour
                </button>
                <button
                  type="button"
                  onClick={toggleBackupCode}
                  className="text-primary hover:underline font-medium"
                >
                  {useBackupCode ? 'Utiliser le code de l’application' : 'Utiliser un code de secours'}
                </button>
              </div>
            </form>
          )}

          <p className="text-xs text-slate-400 text-center mt-6">
            SOLIDATA ERP — Solidarité Textiles Normandie
          </p>
        </div>
      </div>
    </div>
  );
}
