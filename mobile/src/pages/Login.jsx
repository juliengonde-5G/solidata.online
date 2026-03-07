import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/vehicle-select');
    } catch (err) {
      setError(err.response?.data?.message || 'Erreur de connexion');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-solidata-green flex flex-col items-center justify-center p-6">
      <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mb-6 shadow-lg">
        <span className="text-solidata-green text-3xl font-bold">S</span>
      </div>
      <h1 className="text-white text-2xl font-bold mb-1">SOLIDATA Mobile</h1>
      <p className="text-white/70 text-sm mb-8">Application terrain — Chauffeurs</p>

      <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
        {error && <div className="bg-red-500/20 border border-red-300/50 text-white text-sm rounded-xl px-4 py-2">{error}</div>}
        <input
          type="text"
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="Identifiant"
          className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50 border border-white/30 focus:bg-white/30 outline-none"
          required
        />
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Mot de passe"
          className="w-full px-4 py-3 rounded-xl bg-white/20 text-white placeholder-white/50 border border-white/30 focus:bg-white/30 outline-none"
          required
        />
        <button type="submit" disabled={loading} className="w-full bg-white text-solidata-green font-bold py-3 rounded-xl shadow-lg disabled:opacity-50">
          {loading ? 'Connexion...' : 'Connexion'}
        </button>
      </form>
    </div>
  );
}
