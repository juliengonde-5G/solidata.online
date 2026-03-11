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
import ReportingCollecte from './pages/ReportingCollecte';
import ReportingRH from './pages/ReportingRH';
import ReportingProduction from './pages/ReportingProduction';
import Refashion from './pages/Refashion';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Referentiels from './pages/Referentiels';
import AdminPredictive from './pages/AdminPredictive';
import CollectionProposals from './pages/CollectionProposals';
import InsertionParcours from './pages/InsertionParcours';
import PCMTest from './pages/PCMTest';
import RGPD from './pages/RGPD';
import AdminDB from './pages/AdminDB';
import AdminCAV from './pages/AdminCAV';
import ReportingMetropole from './pages/ReportingMetropole';
import FillRateMap from './pages/FillRateMap';
import NewsFeed from './pages/NewsFeed';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen bg-[var(--color-bg)]"><div className="animate-spin rounded-full h-12 w-12 border-2 border-primary border-t-transparent"></div></div>;
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
          <Route path="/pcm-test/:token" element={<PCMTest />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />

          {/* Recrutement */}
          <Route path="/candidates" element={<ProtectedRoute roles={['ADMIN', 'RH']}><Candidates /></ProtectedRoute>} />
          <Route path="/pcm" element={<ProtectedRoute roles={['ADMIN', 'RH']}><PersonalityMatrix /></ProtectedRoute>} />

          {/* Équipe */}
          <Route path="/employees" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Employees /></ProtectedRoute>} />
          <Route path="/work-hours" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><WorkHours /></ProtectedRoute>} />
          <Route path="/skills" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><Skills /></ProtectedRoute>} />
          <Route path="/insertion" element={<ProtectedRoute roles={['ADMIN', 'RH', 'MANAGER']}><InsertionParcours /></ProtectedRoute>} />

          {/* Collecte */}
          <Route path="/tours" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Tours /></ProtectedRoute>} />
          <Route path="/collection-proposals" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><CollectionProposals /></ProtectedRoute>} />
          <Route path="/cav-map" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><CAVMap /></ProtectedRoute>} />
          <Route path="/fill-rate" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><FillRateMap /></ProtectedRoute>} />
          <Route path="/vehicles" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Vehicles /></ProtectedRoute>} />
          <Route path="/live-vehicles" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><LiveVehicles /></ProtectedRoute>} />

          {/* Tri / Production */}
          <Route path="/production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Production /></ProtectedRoute>} />
          <Route path="/chaine-tri" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ChaineTri /></ProtectedRoute>} />
          <Route path="/stock" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Stock /></ProtectedRoute>} />
          <Route path="/produits-finis" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ProduitsFinis /></ProtectedRoute>} />
          <Route path="/expeditions" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Expeditions /></ProtectedRoute>} />

          {/* Reporting */}
          <Route path="/reporting-collecte" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ReportingCollecte /></ProtectedRoute>} />
          <Route path="/reporting-rh" element={<ProtectedRoute roles={['ADMIN', 'RH']}><ReportingRH /></ProtectedRoute>} />
          <Route path="/reporting-production" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ReportingProduction /></ProtectedRoute>} />
          <Route path="/reporting" element={<Navigate to="/reporting-collecte" />} />
          <Route path="/refashion" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><Refashion /></ProtectedRoute>} />
          <Route path="/reporting-metropole" element={<ProtectedRoute roles={['ADMIN', 'MANAGER']}><ReportingMetropole /></ProtectedRoute>} />

          {/* Administration */}
          <Route path="/users" element={<ProtectedRoute roles={['ADMIN']}><Users /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute roles={['ADMIN']}><Settings /></ProtectedRoute>} />
          <Route path="/referentiels" element={<ProtectedRoute roles={['ADMIN']}><Referentiels /></ProtectedRoute>} />
          <Route path="/admin-predictive" element={<ProtectedRoute roles={['ADMIN']}><AdminPredictive /></ProtectedRoute>} />
          <Route path="/rgpd" element={<ProtectedRoute roles={['ADMIN']}><RGPD /></ProtectedRoute>} />
          <Route path="/admin-db" element={<ProtectedRoute roles={['ADMIN']}><AdminDB /></ProtectedRoute>} />
          <Route path="/admin-cav" element={<ProtectedRoute roles={['ADMIN']}><AdminCAV /></ProtectedRoute>} />
          <Route path="/news" element={<ProtectedRoute><NewsFeed /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
