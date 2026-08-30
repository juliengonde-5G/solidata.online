import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true,
});

// Intercepteur request : ajoute le token Bearer
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Intercepteur response : refresh auto sur 401
let isRefreshing = false;
let failedQueue = [];

function processQueue(error, token) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token);
  });
  failedQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Session révoquée côté serveur (déconnexion, reset de mot de passe,
    // désactivation du compte, « forcer la déconnexion ») : le refresh token a
    // été purgé, inutile de tenter un rafraîchissement. On nettoie et on renvoie
    // vers la connexion. (Audit vague 3, item 3.C-1 — code TOKEN_REVOKED.)
    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_REVOKED') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    // Double authentification requise (chantier 2.43.0) : le jeton porté est
    // valide mais n'a jamais franchi le défi TOTP (jeton hérité d'avant le
    // déploiement, ou MFA désactivée/réinitialisée entre-temps par un admin).
    // Contrairement à TOKEN_EXPIRED, aucun rafraîchissement silencieux ne
    // peut résoudre ce cas — seule une reconnexion complète (qui repose le
    // défi MFA) le peut. On purge et on renvoie vers /login, sans tenter de
    // refresh. (Les appels faits pendant l'écran d'enrôlement obligatoire lui-
    // même — /permissions/my-modules notamment — sont évités côté
    // AuthContext tant que l'enrôlement n'est pas terminé, précisément pour
    // ne jamais déclencher ce cas en pleine connexion qui vient de réussir.)
    if (error.response?.status === 403 && error.response?.data?.code === 'MFA_REQUIRED') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Refresh token est exclusivement transporté via cookie HttpOnly.
        // withCredentials assure son envoi automatique. Aucun stockage localStorage.
        const res = await axios.post('/api/auth/refresh', {}, { withCredentials: true });
        const { accessToken } = res.data;

        localStorage.setItem('accessToken', accessToken);

        processQueue(null, accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('accessToken');
        // Nettoyage défensif d'éventuels résidus de l'ancien stockage
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ─── API capteurs LoRaWAN CAV ──────────────────────────
export const sensorsApi = {
  list: () => api.get('/cav/sensors').then((r) => r.data),
  status: (cavId) => api.get(`/cav/${cavId}/sensor-status`).then((r) => r.data),
  history: (cavId, days = 30) => api.get(`/cav/${cavId}/sensor-history`, { params: { days } }).then((r) => r.data),
  rawReadings: (cavId, limit = 100) => api.get(`/cav/${cavId}/sensor-readings-raw`, { params: { limit } }).then((r) => r.data),
  diagnostic: (cavId) => api.get(`/cav/${cavId}/sensor-diagnostic`).then((r) => r.data),
  provision: (cavId, payload) => api.post(`/cav/${cavId}/sensor/provision`, payload).then((r) => r.data),
  updateCalibration: (cavId, payload) => api.patch(`/cav/${cavId}/sensor-calibration`, payload).then((r) => r.data),
  deprovision: (cavId) => api.delete(`/cav/${cavId}/sensor`).then((r) => r.data),
  reassign: (sourceCavId, targetCavId) => api.post('/cav/sensors/reassign', { source_cav_id: sourceCavId, target_cav_id: targetCavId }).then((r) => r.data),
  ackAlert: (alertId) => api.post(`/cav/sensors/alerts/${alertId}/ack`).then((r) => r.data),
  liveObjectsDevices: () => api.get('/cav/liveobjects-devices').then((r) => r.data),
};

export default api;
