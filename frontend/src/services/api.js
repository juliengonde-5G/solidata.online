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
        // Send refresh request — cookie will be sent automatically via withCredentials
        // Also send refreshToken from localStorage as fallback for backward compatibility
        const refreshToken = localStorage.getItem('refreshToken');
        const res = await axios.post('/api/auth/refresh', { refreshToken: refreshToken || undefined }, { withCredentials: true });
        const { accessToken, refreshToken: newRefresh } = res.data;

        localStorage.setItem('accessToken', accessToken);
        if (newRefresh) {
          localStorage.setItem('refreshToken', newRefresh);
        }

        processQueue(null, accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('accessToken');
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
  deprovision: (cavId) => api.delete(`/cav/${cavId}/sensor`).then((r) => r.data),
  reassign: (sourceCavId, targetCavId) => api.post('/cav/sensors/reassign', { source_cav_id: sourceCavId, target_cav_id: targetCavId }).then((r) => r.data),
  ackAlert: (alertId) => api.post(`/cav/sensors/alerts/${alertId}/ack`).then((r) => r.data),
  liveObjectsDevices: () => api.get('/cav/liveobjects-devices').then((r) => r.data),
};

export default api;
