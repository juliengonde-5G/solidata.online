import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

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

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      api.get('/auth/me')
        .then(res => { setUser(res.data); return loadModulePermissions(res.data); })
        .catch(() => {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [loadModulePermissions]);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    // Le refresh token est posé par le backend en cookie HttpOnly
    // (résistant à XSS). Seul l'access token (8h) reste en localStorage.
    localStorage.setItem('accessToken', res.data.accessToken);
    setUser(res.data.user);
    loadModulePermissions(res.data.user);
    return res.data.user;
  };

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
    <AuthContext.Provider value={{ user, loading, login, logout, updatePassword, deniedModules, canAccessModule }}>
      {user && user.must_change_password ? <ForcePasswordChange /> : children}
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

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return context;
}
