import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mobile_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED') {
      // Send refresh request — cookie will be sent automatically via withCredentials
      // Also send refreshToken from localStorage as fallback for backward compatibility
      const refreshToken = localStorage.getItem('mobile_refresh_token');
      if (refreshToken || document.cookie.includes('refreshToken')) {
        try {
          const res = await axios.post('/api/auth/refresh', { refreshToken: refreshToken || undefined }, { withCredentials: true });
          const { accessToken, refreshToken: newRefresh } = res.data;
          localStorage.setItem('mobile_token', accessToken);
          if (newRefresh) {
            localStorage.setItem('mobile_refresh_token', newRefresh);
          }
          error.config.headers.Authorization = `Bearer ${accessToken}`;
          return api(error.config);
        } catch {
          localStorage.removeItem('mobile_token');
          localStorage.removeItem('mobile_refresh_token');
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
