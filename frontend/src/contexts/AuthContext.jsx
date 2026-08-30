import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Copy, Printer } from 'lucide-react';
import api from '../services/api';

const AuthContext = createContext(null);

const CODE_INPUT_LENGTH = 6;

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Modules refusés au rôle du user (habilitations). Vide = tout autorisé.
  const [deniedModules, setDeniedModules] = useState([]);

  // Charge les modules refusés pour le rôle courant (fail-open : en cas
  // d'erreur on n'interdit rien, la navigation n'est jamais bloquée).
  const loadModulePermissions = useCallback(async (u) => {
    if (!u) { setDeniedModules([]); return; }
    if (u.role === 'ADMIN') { setDeniedModules([]); return; }
    try {
      const res = await api.get('/permissions/my-modules');
      setDeniedModules(Array.isArray(res.data?.denied) ? res.data.denied : []);
    } catch {
      setDeniedModules([]);
    }
  }, []);

  // /permissions/my-modules fait partie des routes protégées par requireMfa
  // (chantier 2.43.0) : un utilisateur dont l'enrôlement MFA est encore en
  // attente (jeton mfa:false) recevrait un 403 MFA_REQUIRED sur cet appel,
  // que l'intercepteur d'api.js traite en purge + retour à /login — ce qui
  // romprait la connexion qui vient tout juste de réussir, avant même que
  // l'écran d'enrôlement obligatoire ait pu s'afficher. Tant que l'enrôlement
  // n'est pas terminé, on n'appelle donc pas cette route : l'écran bloquant
  // prend le relais et aucune autre route protégée n'est sollicitée.
  const maybeLoadModulePermissions = useCallback((u) => {
    if (u?.mfa_enrollment_required) return Promise.resolve();
    return loadModulePermissions(u);
  }, [loadModulePermissions]);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      api.get('/auth/me')
        .then(res => { setUser(res.data); return maybeLoadModulePermissions(res.data); })
        .catch(() => {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [maybeLoadModulePermissions]);

  // Applique une session complète (jetons + utilisateur) — commune au login
  // direct, à la vérification MFA et à la fin de l'enrôlement.
  const applySession = useCallback((data) => {
    localStorage.setItem('accessToken', data.accessToken);
    setUser(data.user);
    maybeLoadModulePermissions(data.user);
  }, [maybeLoadModulePermissions]);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    // Compte soumis à la double authentification et déjà enrôlé : aucun
    // jeton n'est émis, il faut d'abord franchir le défi TOTP — on renvoie
    // la réponse telle quelle pour que Login.jsx bascule sur l'étape 2.
    if (res.data?.mfa_required) {
      return res.data;
    }
    // Le refresh token est posé par le backend en cookie HttpOnly
    // (résistant à XSS). Seul l'access token (8h) reste en localStorage.
    applySession(res.data);
    return res.data.user;
  };

  // Étape 2 du login MFA : consomme le jeton de défi + le code TOTP (ou un
  // code de secours) et obtient la session complète, exactement comme login().
  const verifyMfa = async (mfaChallengeToken, code) => {
    const res = await api.post('/auth/mfa/verify', { mfa_challenge_token: mfaChallengeToken, code });
    applySession(res.data);
    return res.data;
  };

  // Recharge l'utilisateur courant depuis le serveur (ex. après l'activation
  // de la double authentification, pour lever mfa_enrollment_required).
  const refreshUser = useCallback(async () => {
    const res = await api.get('/auth/me');
    setUser(res.data);
    await maybeLoadModulePermissions(res.data);
    return res.data;
  }, [maybeLoadModulePermissions]);

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (_) {}
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
    setDeniedModules([]);
  };

  const updatePassword = async (currentPassword, newPassword) => {
    await api.put('/auth/password', { currentPassword, newPassword });
    // Le backend a remis must_change_password à false : on reflète l'état
    // localement pour lever l'écran de changement forcé le cas échéant.
    setUser((u) => (u ? { ...u, must_change_password: false } : u));
  };

  // Un module (section de 1er niveau) est-il visible pour le user courant ?
  const canAccessModule = useCallback(
    (key) => user?.role === 'ADMIN' || !deniedModules.includes(key),
    [user?.role, deniedModules]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updatePassword, verifyMfa, refreshUser, deniedModules, canAccessModule }}>
      {user && user.must_change_password ? (
        <ForcePasswordChange />
      ) : user && user.mfa_enrollment_required ? (
        <ForceMfaEnrollment />
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

// Écran BLOQUANT de changement de mot de passe (audit item 1).
// Affiché tant que le compte connecté a must_change_password = true : l'utilisateur
// ne peut accéder à aucune page de l'application avant d'avoir défini un nouveau
// mot de passe (≥ 10 caractères). Un lien de déconnexion reste disponible.
function ForcePasswordChange() {
  const { updatePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 10) {
      setError('Le nouveau mot de passe doit contenir au moins 10 caractères.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Le nouveau mot de passe doit être différent de l\'actuel.');
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(currentPassword, newPassword);
      // Succès : updatePassword efface must_change_password → l'écran se ferme.
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de modifier le mot de passe.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[var(--color-bg)] overflow-y-auto">
      <div className="relative w-full max-w-md">
        <div className="card-modern p-8 sm:p-10 shadow-elevated">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
              <span className="text-white text-2xl font-bold">S</span>
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Changement de mot de passe requis</h1>
            <p className="text-slate-500 mt-2 text-sm">
              Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant d'accéder à l'application.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-button text-sm" role="alert">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Mot de passe actuel</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input-modern"
                placeholder="••••••••"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Nouveau mot de passe</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input-modern"
                placeholder="Au moins 10 caractères"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirmer le nouveau mot de passe</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-modern"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full py-3 rounded-button font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Enregistrement...' : 'Valider le nouveau mot de passe'}
            </button>
          </form>

          <button
            type="button"
            onClick={logout}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-600 mt-6"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}

// Imprime les codes de secours dans une fenêtre dédiée (même mécanisme
// « maison » que les exports PDF du projet : window.open + window.print(),
// aucune librairie ajoutée).
function printBackupCodes(codes) {
  const w = window.open('', '_blank', 'width=480,height=640');
  if (!w) return false;
  const dateStr = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  const rows = codes.map((c) => `<div class="code">${c}</div>`).join('');
  w.document.write(
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>Codes de secours SOLIDATA</title><style>'
    + '@page { size: A4; margin: 20mm; }'
    + '* { box-sizing: border-box; margin: 0; padding: 0; }'
    + "body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; }"
    + '.header { background: #0D9488; color: white; padding: 16px 24px; }'
    + '.header h1 { font-size: 18px; }'
    + '.header .sub { font-size: 12px; opacity: .9; margin-top: 4px; }'
    + '.content { padding: 24px; }'
    + '.warn { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; border-radius: 8px; padding: 12px 16px; font-size: 13px; margin-bottom: 20px; }'
    + '.codes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }'
    + ".code { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; text-align: center; font-family: 'Courier New', monospace; font-size: 16px; letter-spacing: 1px; }"
    + '</style></head><body>'
    + '<div class="header"><h1>SOLIDATA — Codes de secours</h1><div class="sub">Double authentification — générés le ' + dateStr + '</div></div>'
    + '<div class="content">'
    + '<div class="warn">Chaque code n\'est utilisable qu\'une seule fois, uniquement en l\'absence de votre application d\'authentification. Conservez ce document en lieu sûr.</div>'
    + '<div class="codes">' + rows + '</div>'
    + '</div></body></html>'
  );
  w.document.close();
  setTimeout(() => w.print(), 400);
  return true;
}

// Écran BLOQUANT d'enrôlement MFA obligatoire (chantier 2.43.0).
// Affiché quand user.mfa_enrollment_required === true : le compte est soumis
// à la double authentification (rôle sensible) mais ne l'a pas encore
// activée. Même pattern que ForcePasswordChange (écran plein cadre, lien de
// déconnexion toujours disponible), en 3 temps : explication → activation →
// codes de secours affichés une seule fois.
function ForceMfaEnrollment() {
  const { logout, refreshUser } = useAuth();
  const [step, setStep] = useState('intro'); // 'intro' | 'setup' | 'success'

  // Étape 1 — préparation (POST /auth/mfa/setup)
  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secretBase32, setSecretBase32] = useState('');

  // Étape 2 — confirmation du premier code (POST /auth/mfa/activate)
  const [confirmCode, setConfirmCode] = useState('');
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState('');

  // Étape 3 — codes de secours (affichés une seule fois)
  const [backupCodes, setBackupCodes] = useState([]);
  const [copied, setCopied] = useState(false);
  const [printError, setPrintError] = useState('');
  const [confirmedSafe, setConfirmedSafe] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState('');

  const handleStart = async () => {
    setSetupError('');
    setSettingUp(true);
    try {
      const res = await api.post('/auth/mfa/setup');
      setQrDataUrl(res.data.qr_data_url || '');
      setSecretBase32(res.data.secret_base32 || '');
      setConfirmCode('');
      setActivateError('');
      setStep('setup');
    } catch (err) {
      setSetupError(err.response?.data?.error || 'Impossible de préparer l\'activation. Réessayez.');
    } finally {
      setSettingUp(false);
    }
  };

  const handleActivateSubmit = async (e) => {
    e.preventDefault();
    setActivateError('');
    setActivating(true);
    try {
      const res = await api.post('/auth/mfa/activate', { code: confirmCode.trim() });
      // Le backend a fait tourner token_version puis réémis un access token
      // portant mfa:true : on le remplace immédiatement (l'ancien serait
      // révoqué au prochain appel).
      if (res.data?.accessToken) {
        localStorage.setItem('accessToken', res.data.accessToken);
      }
      setBackupCodes(Array.isArray(res.data.backup_codes) ? res.data.backup_codes : []);
      setConfirmedSafe(false);
      setCopied(false);
      setPrintError('');
      setStep('success');
    } catch (err) {
      setActivateError(err.response?.data?.error || 'Code invalide. Vérifiez l’heure de votre appareil et réessayez.');
    } finally {
      setActivating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible (contexte non sécurisé, permission refusée) :
      // pas de blocage, les codes restent lisibles et copiables à la main.
    }
  };

  const handlePrint = () => {
    setPrintError('');
    const ok = printBackupCodes(backupCodes);
    if (!ok) setPrintError('Fenêtre d\'impression bloquée — autorisez les popups pour imprimer.');
  };

  const handleFinish = async () => {
    if (!confirmedSafe) return;
    setFinishError('');
    setFinishing(true);
    try {
      // Recharge l'utilisateur : mfa_enrollment_required repasse à false
      // côté serveur (mfa_enabled est désormais true), ce qui lève l'écran.
      await refreshUser();
    } catch (err) {
      setFinishError('Impossible de finaliser automatiquement. Rechargez la page — l\'activation est déjà enregistrée.');
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[var(--color-bg)] overflow-y-auto">
      <div className="relative w-full max-w-md py-6">
        <div className="card-modern p-8 sm:p-10 shadow-elevated">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/20">
              <span className="text-white text-2xl font-bold">S</span>
            </div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Double authentification requise</h1>
            {step === 'intro' && (
              <p className="text-slate-500 mt-2 text-sm">
                Votre profil accède à des données personnelles sensibles : la double authentification devient
                obligatoire avant de poursuivre.
              </p>
            )}
            {step === 'setup' && (
              <p className="text-slate-500 mt-2 text-sm">
                Scannez le QR code avec votre application d'authentification, puis saisissez le code affiché.
              </p>
            )}
            {step === 'success' && (
              <p className="text-slate-500 mt-2 text-sm">
                Activation réussie. Conservez vos codes de secours avant de continuer.
              </p>
            )}
          </div>

          {step === 'intro' && (
            <div className="space-y-4">
              {setupError && (
                <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-button text-sm" role="alert">
                  {setupError}
                </div>
              )}
              <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p className="font-medium text-slate-700 mb-1.5">Ce qu'il vous faut :</p>
                <p>
                  Une application d'authentification installée sur votre téléphone — Google Authenticator, Microsoft
                  Authenticator, FreeOTP ou toute autre application compatible TOTP.
                </p>
              </div>
              <button
                type="button"
                onClick={handleStart}
                disabled={settingUp}
                className="btn-primary w-full py-3 rounded-button font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {settingUp ? 'Préparation...' : 'Commencer'}
              </button>
            </div>
          )}

          {step === 'setup' && (
            <div className="space-y-4">
              {qrDataUrl && (
                <div className="flex justify-center">
                  {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                  <img
                    src={qrDataUrl}
                    alt="QR code d'activation de la double authentification"
                    className="w-40 h-40 rounded-lg border border-slate-200 p-2 bg-white"
                  />
                </div>
              )}
              {secretBase32 && (
                <details className="text-xs text-slate-500">
                  <summary className="cursor-pointer font-medium text-slate-600 select-none">
                    Je ne peux pas scanner le QR code
                  </summary>
                  <p className="mt-2">Saisissez cette clé manuellement dans votre application :</p>
                  <p className="mt-1 font-mono text-sm tracking-wider bg-slate-50 border border-slate-200 rounded px-3 py-2 break-all">
                    {secretBase32}
                  </p>
                </details>
              )}

              <form onSubmit={handleActivateSubmit} className="space-y-3 pt-3 border-t border-slate-100">
                {activateError && (
                  <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-button text-sm" role="alert">
                    {activateError}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Code affiché par l'application
                  </label>
                  <input
                    type="text"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, CODE_INPUT_LENGTH))}
                    className="input-modern text-center tracking-[0.35em] font-mono text-lg"
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={CODE_INPUT_LENGTH}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={activating || confirmCode.length < CODE_INPUT_LENGTH}
                  className="btn-primary w-full py-3 rounded-button font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {activating ? 'Vérification...' : 'Activer la double authentification'}
                </button>
              </form>
            </div>
          )}

          {step === 'success' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
                Ces 8 codes de secours ne seront plus jamais affichés. Chacun ne peut être utilisé qu'une seule fois,
                en l'absence de votre application d'authentification.
              </div>

              <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg p-4">
                {backupCodes.map((c) => (
                  <div key={c} className="text-center py-1 tracking-wider">{c}</div>
                ))}
              </div>

              {printError && (
                <div className="bg-red-50 border border-red-100 text-red-700 px-3 py-2 rounded-button text-xs" role="alert">
                  {printError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 btn-ghost text-sm inline-flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-4 h-4" strokeWidth={1.8} /> {copied ? 'Copié !' : 'Copier'}
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex-1 btn-ghost text-sm inline-flex items-center justify-center gap-1.5"
                >
                  <Printer className="w-4 h-4" strokeWidth={1.8} /> Imprimer
                </button>
              </div>

              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={confirmedSafe}
                  onChange={(e) => setConfirmedSafe(e.target.checked)}
                  className="rounded mt-0.5"
                />
                J'ai conservé ces codes en lieu sûr.
              </label>

              {finishError && (
                <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-button text-sm" role="alert">
                  {finishError}
                </div>
              )}

              <button
                type="button"
                onClick={handleFinish}
                disabled={!confirmedSafe || finishing}
                className="btn-primary w-full py-3 rounded-button font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {finishing ? 'Finalisation...' : 'Terminer'}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={logout}
            className="w-full text-center text-xs text-slate-400 hover:text-slate-600 mt-6"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return context;
}
