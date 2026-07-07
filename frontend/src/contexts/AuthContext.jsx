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
  };

  // Un module (section de 1er niveau) est-il visible pour le user courant ?
  const canAccessModule = useCallback(
    (key) => user?.role === 'ADMIN' || !deniedModules.includes(key),
    [user?.role, deniedModules]
  );

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updatePassword, deniedModules, canAccessModule }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return context;
}
