import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Candidates from './pages/Candidates';
import PersonalityMatrix from './pages/PersonalityMatrix';
import Employees from './pages/Employees';
import WorkHours from './pages/WorkHours';
import Skills from './pages/Skills';
import Tours from './pages/Tours';
import CAVMap from './pages/CAVMap';
import Vehicles from './pages/Vehicles';
import LiveVehicles from './pages/LiveVehicles';
import Production from './pages/Production';
import ChaineTri from './pages/ChaineTri';
import Stock from './pages/Stock';
import ProduitsFinis from './pages/ProduitsFinis';
import Expeditions from './pages/Expeditions';
import Reporting from './pages/Reporting';
import Refashion from './pages/Refashion';
import Billing from './pages/Billing';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Referentiels from './pages/Referentiels';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-solidata-green"></div></div>;
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

          {/* Recrutement */}
          <Route path="/candidates" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Candidates /></ProtectedRoute>} />
          <Route path="/pcm" element={<ProtectedRoute roles={['ADMIN', 'RH']}><PersonalityMatrix /></ProtectedRoute>} />

          {/* Équipe */}
          <Route path="/employees" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Employees /></ProtectedRoute>} />
          <Route path="/work-hours" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><WorkHours /></ProtectedRoute>} />
          <Route path="/skills" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Skills /></ProtectedRoute>} />

          {/* Collecte */}
          <Route path="/tours" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Tours /></ProtectedRoute>} />
          <Route path="/cav-map" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><CAVMap /></ProtectedRoute>} />
          <Route path="/vehicles" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Vehicles /></ProtectedRoute>} />
          <Route path="/live-vehicles" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><LiveVehicles /></ProtectedRoute>} />

          {/* Tri / Production */}
          <Route path="/production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Production /></ProtectedRoute>} />
          <Route path="/chaine-tri" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ChaineTri /></ProtectedRoute>} />
          <Route path="/stock" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Stock /></ProtectedRoute>} />
          <Route path="/produits-finis" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ProduitsFinis /></ProtectedRoute>} />
          <Route path="/expeditions" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Expeditions /></ProtectedRoute>} />

          {/* Reporting */}
          <Route path="/reporting" element={<ProtectedRoute roles={['ADMIN', 'MANAGER', 'AUTORITE']}><Reporting /></ProtectedRoute>} />
          <Route path="/refashion" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Refashion /></ProtectedRoute>} />
          <Route path="/billing" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Billing /></ProtectedRoute>} />

          {/* Administration */}
          <Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><Users /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute roles={['ADMIN']}><Settings /></ProtectedRoute>} />
          <Route path="/referentiels" element={<ProtectedRoute roles={['ADMIN']}><Referentiels /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
