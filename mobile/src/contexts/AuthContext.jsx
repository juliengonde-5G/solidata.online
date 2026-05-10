import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('mobile_token');
    if (token) {
      api.get('/auth/me')
        .then(res => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('mobile_token');
          localStorage.removeItem('mobile_refresh_token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    localStorage.setItem('mobile_token', res.data.token);
    localStorage.setItem('mobile_refresh_token', res.data.refreshToken);
    setUser(res.data.user);
    return res.data;
  };

  // driverStart : démarrage chauffeur via le qr_token véhicule (« 1 URL = 1 véhicule »).
  // Pour le détail du flux, voir mobile/src/pages/VehicleLogin.jsx.
  const driverStart = async (vehicleToken) => {
    const res = await api.post('/auth/driver-start', { vehicle_token: vehicleToken });
    localStorage.setItem('mobile_token', res.data.token);
    if (res.data.refreshToken) localStorage.setItem('mobile_refresh_token', res.data.refreshToken);
    setUser(res.data.user);
    return res.data;
  };

  const logout = () => {
    localStorage.removeItem('mobile_token');
    localStorage.removeItem('mobile_refresh_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, driverStart, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
